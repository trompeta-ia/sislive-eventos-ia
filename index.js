const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cors({ origin: (origin, cb) => cb(null, true) }));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;

const ESTILO = "professional event photo booth portrait, the person kept clearly recognizable and centered, natural realistic face, even flattering lighting, sharp focus, high detail, vibrant colors, cinematic photography";

const NEGATIVO = "deformed, distorted face, disfigured, extra limbs, extra fingers, mutated hands, bad anatomy, blurry, low quality, low resolution, watermark, text, logo, ugly, creepy, duplicate, cropped face, changed identity";

const ESCENAS = {
  "MURGUISTA":         "A colorful Uruguayan carnival murga performer stands next to the person, wearing a bright striped and sequined costume with dramatic painted white-and-color face makeup and a feathered hat, festive carnival stage with warm spotlights and confetti in the background",
  "CANDOMBERO":        "An Uruguayan candombe drummer stands beside the person playing a large wooden tambor drum strapped over the shoulder, traditional white outfit with a colorful sash, warm nighttime street-carnival atmosphere with glowing lanterns behind",
  "GAUCHO":            "A traditional Uruguayan gaucho stands next to the person wearing a wide-brimmed hat, neckerchief, poncho and leather belt, holding mate, warm golden pampa sunset with horses in the soft background",
  "HINCHA CELESTE":    "The person is surrounded by a joyful sky-blue and white football celebration, wearing a generic sky-blue supporter scarf, confetti, flags and a packed stadium glowing behind, triumphant festive energy",
  "SAFARI":            "The person is on an African safari wearing a light explorer hat, a calm friendly lion sits peacefully beside them, golden savannah with acacia trees and warm sunset light in the background",
  "ASTRONAUTA":        "The person wears a detailed white astronaut spacesuit with the helmet under the arm, floating gently in outer space with planets, stars and a glowing nebula behind them",
  "PIRATA":            "The person stands on the wooden deck of a pirate ship dressed in a pirate coat and hat, an open treasure chest full of gold beside them, sails and stormy ocean horizon behind, adventurous cinematic lighting",
  "BUZO":              "The person is in a scuba diving scene wearing a diving mask, surrounded by colorful tropical fish and a vibrant coral reef, bright sun rays streaming down through clear blue water",
  "PRINCESA DE HIELO": "The person becomes an elegant ice-themed royalty wearing a shimmering pale-blue crystalline gown and a delicate ice tiara, standing in a magical glittering ice palace with soft cold blue light and sparkling snowflakes",
  "SIRENA":            "The person is a mermaid-themed character in an enchanted underwater kingdom, iridescent scaled tail motif, glowing seashells, pearls and soft turquoise light with gentle bubbles rising",
  "HADA DEL BOSQUE":   "The person is a forest fairy with delicate translucent glowing wings and a flower crown, standing in a magical enchanted forest at dusk with floating fairy lights and soft golden bokeh",
  "REINA MEDIEVAL":    "The person is medieval royalty wearing an ornate crown and a rich velvet royal robe, standing in a grand castle throne room with warm torch light, tapestries and stone columns behind",
  "HÉROE DEL TRUENO":  "The person becomes a thunder-god superhero with glowing energy armor and crackling blue lightning around them, dramatic dark storm clouds and epic god-rays in the background, powerful heroic pose",
  "GUERRERA AMAZONA":  "The person becomes an amazon warrior princess with golden armored accents and a bold headband, standing on an epic battlefield ridge at golden hour with a dramatic sky behind, heroic and strong",
  "SOMBRA NOCTURNA":   "The person becomes a dark masked night vigilante hero in a sleek dark suit and flowing cape, standing on a rooftop above a glowing nighttime city skyline under a full moon, moody blue cinematic lighting",
  "VELOCISTA":         "The person becomes a speedster superhero in a sleek red-and-gold suit with glowing lightning and motion-blur energy trails swirling around them, dynamic action background with electric sparks",
};

const MODELO = "gemini-2.5-flash-image";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (_req, res) => res.send("Servidor SIS Eventos IA — OK"));

app.post("/generar", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const { cara, personaje } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) return res.status(400).json({ error: "Falta la foto" });
    const escena = ESCENAS[personaje];
    if (!escena) return res.status(400).json({ error: "Personaje desconocido: " + personaje });

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
