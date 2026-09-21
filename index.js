const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cors({ origin: (origin, cb) => cb(null, true) }));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;

const PERSONAJES = {
  "MURGUISTA":         "Add a colorful Uruguayan carnival murga performer in bright striped costume and painted face standing next to the person, festive stage lighting, photorealistic",
  "CANDOMBERO":        "Add an Uruguayan candombe drummer playing a large tambor drum beside the person, warm street carnival atmosphere at night, photorealistic",
  "GAUCHO":            "Add a traditional Uruguayan gaucho wearing a hat, neckerchief and poncho standing next to the person, rural pampa sunset background, photorealistic",
  "HINCHA CELESTE":    "Surround the person with a festive sky-blue and white football supporters celebration, confetti, flags and stadium atmosphere, photorealistic",
  "SAFARI":            "Place the person in an African safari scene with a friendly lion sitting calmly beside them, golden savannah background, photorealistic",
  "ASTRONAUTA":        "Place the person in an astronaut themed scene with a spacesuit helmet nearby, floating among planets and stars, photorealistic",
  "PIRATA":            "Place the person on the wooden deck of a pirate ship with an open treasure chest and the ocean behind, adventurous cinematic lighting, photorealistic",
  "BUZO":              "Place the person in an underwater diving scene surrounded by colorful fish and coral reef, sun rays through the water, photorealistic",
  "PRINCESA DE HIELO": "Transform the scene into a magical ice palace, surround the person with sparkling snow and ice-crystal effects, elegant cold blue lighting, photorealistic",
  "SIRENA":            "Place the person in an enchanted underwater kingdom with a mermaid tail theme, glowing seashells and soft light, fantasy photorealistic",
  "HADA DEL BOSQUE":   "Surround the person with a magical enchanted forest, glowing fairy lights and delicate translucent fairy wings, soft dreamy lighting, photorealistic",
  "REINA MEDIEVAL":    "Place the person in a medieval castle throne room with an elegant crown and royal robe theme, warm torch lighting, photorealistic",
  "HÃ‰ROE DEL TRUENO":  "Add a dramatic thunder-god superhero theme around the person with lightning, storm clouds and glowing energy, epic cinematic lighting, photorealistic",
  "GUERRERA AMAZONA":  "Add a warrior-princess amazon theme around the person with golden armor accents and an epic battlefield sky, heroic lighting, photorealistic",
  "SOMBRA NOCTURNA":   "Add a dark masked night-hero theme around the person with a dramatic city skyline at night and moody blue lighting, photorealistic",
  "VELOCISTA":         "Add a speedster superhero theme around the person with motion-blur energy trails and glowing lightning, dynamic cinematic lighting, photorealistic",
};

const MODELO = "gemini-2.5-flash-image";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (_req, res) => res.send("Servidor SIS Eventos IA â€” OK"));

app.post("/generar", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const { cara, personaje } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) return res.status(400).json({ error: "Falta la foto" });
    const instruccion = PERSONAJES[personaje];
    if (!instruccion) return res.status(400).json({ error: "Personaje desconocido: " + personaje });

    const idImagen = await subirCara(cara);
    const genId = await pedirGeneracion(idImagen, instruccion);
    const urlFinal = await esperarResultado(genId);
    return res.status(200).json({ url: urlFinal });
  } catch (e) {
    console.error("Error generando:", e.message);
    return res.status(500).json({ error: "No se pudo generar la foto" });
  }
});

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

async function pedirGeneracion(idImagen, instruccion) {
  const r = await fetch(`${LEONARDO}/v2/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      public: false,
      model: MODELO,
      parameters: {
        prompt: instruccion,
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
    (d.sdGenerationJob && d.sdGenerationJob.generationId) ||
    (d.generations_by_pk && d.generations_by_pk.id) ||
    (d.generation && d.generation.id) ||
    (d.data && d.data.id) ||
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