const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cors({ origin: (origin, cb) => cb(null, true) }));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;
const DB_URL = "https://sis-eventos-default-rtdb.firebaseio.com";

// Estilo base y negativo: siguen en el servidor (son globales, no se editan por personaje).
const ESTILO = "keep every person from the original photo, between one and four people, each face kept clearly recognizable, natural realistic faces, faces fully visible and not covered, professional event photo booth portrait, even flattering lighting, sharp focus, high detail, vibrant colors, cinematic photography";
const NEGATIVO = "deformed, distorted face, disfigured, extra limbs, extra fingers, mutated hands, bad anatomy, blurry, low quality, low resolution, watermark, text, logo, ugly, creepy, duplicate, cropped face, changed identity, extra people, missing people, face mask covering face, club crest, team logo, emblem";

const MODELO = "gemini-2.5-flash-image";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (_req, res) => res.send("Servidor SIS Eventos IA — OK"));

app.post("/generar", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const { cara, personaje, eventoId } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) return res.status(400).json({ error: "Falta la foto" });
    if (!personaje) return res.status(400).json({ error: "Falta el personaje" });

    // Buscamos el prompt del personaje en la base de datos (editable desde el panel)
    const escena = await buscarPromptEnBase(eventoId || "andres", personaje);
    if (!escena) return res.status(400).json({ error: "Personaje sin prompt: " + personaje });

    const prompt = escena + ". " + ESTILO;

    const idImagen = await subirCara(cara);
    const genId = await pedirGeneracion(idImagen, prompt);
    const urlFinal = await esperarResultado(genId);
    return res.status(200).json({ url: urlFinal });
  } catch (e) {
    console.error("Error generando:", e.message);
    return res.status(500).json({ error: "No se pudo generar la foto" });
  }
});

// Lee la biblioteca compartida y busca el personaje por nombre
async function buscarPromptEnBase(eventoId, nombrePersonaje) {
  const r = await fetch(`${DB_URL}/biblioteca/universos.json`);
  if (!r.ok) return null;
  const universos = await r.json();
  if (!universos) return null;
  for (const uKey of Object.keys(universos)) {
    const subs = universos[uKey].subs || {};
    for (const sKey of Object.keys(subs)) {
      if (subs[sKey].nombre === nombrePersonaje) {
        return subs[sKey].prompt || null;
      }
    }
  }
  return null;
}

async function subirCara(base64) {
  const r1 = await fetch(`${LEONARDO}/v1/init-image`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ extension: "jpg" }),
  });
  if (!r1.ok) throw new Error("init-image fallo: " + r1.status);
  const d1 = await r1.json();
  const campos = d1.uploadInitImage.fields;
  const url = d1.uploadInitImage.url;
  const imageId = d1.uploadInitImage.id;
  const fields = typeof campos === "string" ? JSON.parse(campos) : campos;

  const buffer = Buffer.from(base64.split(",")[1], "base64");
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", new Blob([buffer], { type: "image/jpeg" }), "cara.jpg");

  const r2 = await fetch(url, { method: "POST", body: form });
  if (!r2.ok) throw new Error("subida S3 fallo: " + r2.status);
  return imageId;
}

async function pedirGeneracion(idImagen, prompt) {
  const r = await fetch(`${LEONARDO}/v2/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      public: false,
      model: MODELO,
      parameters: {
        prompt: prompt,
        negative_prompt: NEGATIVO,
        width: 1024,
        height: 1024,
        prompt_enhance: "OFF",
        guidances: { image_reference: [ { image: { id: idImagen, type: "UPLOADED" } } ] },
      },
    }),
  });
  const texto = await r.text();
  console.log("RESPUESTA LEONARDO (status " + r.status + "):", texto);
  if (!r.ok) throw new Error("generacion fallo: " + r.status);
  let d = {};
  try { d = JSON.parse(texto); } catch (e) {}
  const genId =
    (d.generate && d.generate.generationId) ||
    (d.sdGenerationJob && d.sdGenerationJob.generationId) ||
    (d.generations_by_pk && d.generations_by_pk.id) ||
    d.generationId || d.id;
  if (!genId) throw new Error("no vino el id de generacion");
  return genId;
}

async function esperarResultado(genId) {
  for (let i = 0; i < 20; i++) {
    await dormir(2000);
    const r = await fetch(`${LEONARDO}/v1/generations/${genId}`, { headers: { authorization: `Bearer ${KEY}` } });
    if (!r.ok) continue;
    const d = await r.json();
    const gen = d.generations_by_pk;
    if (gen && gen.status === "COMPLETE" && gen.generated_images && gen.generated_images.length) {
      return gen.generated_images[0].url;
    }
    if (gen && gen.status === "FAILED") throw new Error("Leonardo FAILED");
  }
  throw new Error("timeout esperando la imagen");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor SIS Eventos IA escuchando en " + PORT));
