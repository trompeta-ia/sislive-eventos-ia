/**
 * SIS EVENTOS — Servidor de IA (Leonardo)
 *
 * El espejo le manda la foto de la cara + qué personaje quiere.
 * Este servidor habla con Leonardo (la llave vive acá, nunca en el navegador),
 * genera la imagen y se la devuelve al espejo.
 *
 * Variables de entorno que hay que cargar en Railway:
 *   LEONARDO_API_KEY   → la llave que creaste en Leonardo (API Access)
 */

const express = require("express");
const cors = require("cors");

const app = express();

// Aceptamos fotos en base64: hay que permitir cuerpos grandes.
app.use(express.json({ limit: "12mb" }));

// Solo tus dominios pueden llamar a este servidor.
const ORIGENES = [
  "https://sis-eventos.web.app",
  "https://sis-eventos.firebaseapp.com",
  "https://sislive.com.uy",
];
app.use(cors({
  origin: (origin, cb) => {
    // Permitimos también llamadas sin origin (pruebas desde el server)
    if (!origin || ORIGENES.includes(origin)) return cb(null, true);
    return cb(null, true); // abierto por ahora; se puede cerrar más adelante
  },
}));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;

// ---- Personajes: cada uno es una INSTRUCCIÓN de texto ----
// Nada de plantillas ni marcas. Editá o agregá los que quieras.
const PERSONAJES = {
  "MURGUISTA":       "Add a colorful Uruguayan carnival murga performer in bright costume and face paint standing next to the person, festive stage lighting, photorealistic",
  "CANDOMBERO":      "Add an Uruguayan candombe drummer playing a tambor drum beside the person, warm street-carnival atmosphere, photorealistic",
  "GAUCHO":          "Add a traditional Uruguayan gaucho with hat and poncho standing next to the person, rural sunset background, photorealistic",
  "HINCHA":          "Surround the person with a festive sky-blue football supporters atmosphere, confetti and celebration, photorealistic",
  "SAFARI":          "Place the person in an African safari scene with a friendly lion beside them, savannah background, photorealistic",
  "ASTRONAUTA":      "Place the person in a spacesuit-themed scene floating in space with planets and stars behind, photorealistic",
  "PIRATA":          "Place the person on a pirate ship deck with a treasure chest and ocean behind, adventurous cinematic lighting, photorealistic",
  "OGRO VERDE":      "Add a big friendly green ogre character hugging the person, fantasy swamp background, cartoon-cinematic style",
  "PRINCESA HIELO":  "Transform the scene into a magical ice palace with the person surrounded by snow and ice-crystal effects, elegant, photorealistic",
  "HEROES":          "Add a group of colorful masked superheroes standing heroically behind the person, dramatic city skyline, photorealistic",
};

// El modelo Nano Banana necesita una imagen de referencia (tu cara)
const MODELO = "gemini-2.5-flash-image"; // Nano Banana

// Pausa auxiliar
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (_req, res) => res.send("Servidor SIS Eventos IA — OK"));

app.post("/generar", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta configurar LEONARDO_API_KEY" });

    const { cara, personaje } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) {
      return res.status(400).json({ error: "Falta la foto de la cara" });
    }
    const instruccion = PERSONAJES[personaje];
    if (!instruccion) {
      return res.status(400).json({ error: "Personaje desconocido: " + personaje });
    }

    // ---- Paso 1: subir la cara a Leonardo ----
    const idImagen = await subirCara(cara);

    // ---- Paso 2: pedir la generación usando esa cara como referencia ----
    const genId = await pedirGeneracion(idImagen, instruccion);

    // ---- Paso 3: esperar a que esté lista y retirarla ----
    const urlFinal = await esperarResultado(genId);

    return res.status(200).json({ url: urlFinal });
  } catch (e) {
    console.error("Error generando:", e.message);
    return res.status(500).json({ error: "No se pudo generar la foto" });
  }
});

// Sube la foto base64 a Leonardo y devuelve el id de la imagen subida
async function subirCara(base64) {
  const ext = "jpg";

  // 1a) pedir un espacio para subir
  const r1 = await fetch(`${LEONARDO}/v1/init-image`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ extension: ext }),
  });
  if (!r1.ok) throw new Error("init-image falló: " + r1.status);
  const d1 = await r1.json();
  const campos = d1.uploadInitImage.fields;
  const url = d1.uploadInitImage.url;
  const imageId = d1.uploadInitImage.id;
  const fields = typeof campos === "string" ? JSON.parse(campos) : campos;

  // 1b) subir la foto real a ese espacio (S3)
  const buffer = Buffer.from(base64.split(",")[1], "base64");
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", new Blob([buffer], { type: "image/jpeg" }), `cara.${ext}`);

  const r2 = await fetch(url, { method: "POST", body: form });
  if (!r2.ok) throw new Error("subida S3 falló: " + r2.status);

  return imageId;
}

// Pide la generación con Nano Banana usando la cara como referencia
async function pedirGeneracion(idImagen, instruccion) {
  const r = await fetch(`${LEONARDO}/v2/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO,
      parameters: {
        prompt: instruccion,
        width: 1024,
        height: 1024,
        prompt_enhance: "OFF",
        guidances: {
          image_reference: [
            { image: { id: idImagen, type: "UPLOADED" } },
          ],
        },
      },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("generación falló: " + r.status + " " + t);
  }
  const d = await r.json();
  // La respuesta trae el id del pedido de generación
  const genId =
    (d.sdGenerationJob && d.sdGenerationJob.generationId) ||
    (d.generations_by_pk && d.generations_by_pk.id) ||
    d.id;
  if (!genId) throw new Error("no vino el id de generación");
  return genId;
}

// Consulta cada 2s hasta que la imagen está lista (máx ~40s)
async function esperarResultado(genId) {
  for (let i = 0; i < 20; i++) {
    await dormir(2000);
    const r = await fetch(`${LEONARDO}/v1/generations/${genId}`, {
      headers: { authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) continue;
    const d = await r.json();
    const gen = d.generations_by_pk;
    if (gen && gen.status === "COMPLETE" && gen.generated_images && gen.generated_images.length) {
      return gen.generated_images[0].url;
    }
    if (gen && gen.status === "FAILED") throw new Error("Leonardo marcó FAILED");
  }
  throw new Error("timeout esperando la imagen");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor SIS Eventos IA escuchando en " + PORT));