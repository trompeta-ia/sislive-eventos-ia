const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cors({ origin: (origin, cb) => cb(null, true) }));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;

// Estilo base: se agrega a TODOS. Incluye respetar cuantas personas hay (1 a 4).
const ESTILO = "keep every person from the original photo, between one and four people, each face kept clearly recognizable, natural realistic faces, faces fully visible and not covered, professional event photo booth portrait, even flattering lighting, sharp focus, high detail, vibrant colors, cinematic photography";

const NEGATIVO = "deformed, distorted face, disfigured, extra limbs, extra fingers, mutated hands, bad anatomy, blurry, low quality, low resolution, watermark, text, logo, ugly, creepy, duplicate, cropped face, changed identity, extra people, missing people, face mask covering face, club crest, team logo, emblem";

const ESCENAS = {
  "MURGUISTA":         "Turn each person into a Uruguayan carnival MURGA performer: heavy theatrical face makeup with bold painted colors and exaggerated eyes and mouth, a tall decorated murga hat, a shiny costume made of colorful patchwork fabric strips, standing on a Uruguayan carnival tablado stage with warm colorful spotlights and confetti behind",
  "CANDOMBERO":        "Turn each person into a Uruguayan CANDOMBE drummer carrying a wooden candombe tambor drum strapped over the shoulder (chico, repique or piano drum), wearing a traditional bright candombe outfit with a colorful sash, warm nighttime Montevideo street carnival with glowing lanterns and other drummers softly behind",
  "GAUCHO":            "Turn each person into a traditional Uruguayan gaucho wearing a wide-brimmed hat, neckerchief, poncho and leather belt, holding mate, warm golden pampa sunset with horses softly in the background",
  "HINCHA TRICOLOR":   "Surround each person with a joyful football supporters celebration in white, blue and red colors (generic tricolor, no crest, no logo, no team name), plain colored scarves and face paint in white blue and red, confetti, flags and a packed stadium glowing behind, triumphant festive energy",
  "HINCHA MANYA":      "Surround each person with a joyful football supporters celebration in yellow and black colors (generic gold and black, no crest, no logo, no team name), plain yellow and black scarves and face paint, confetti, flags and a packed stadium glowing behind, triumphant festive energy",
  "HINCHA CELESTE":    "Surround each person with a joyful Uruguay national team football celebration in sky-blue and white colors (generic, no crest, no logo), plain sky-blue supporter scarves and face paint, confetti, sun-and-stripes festive flags and a packed stadium glowing behind, triumphant festive energy",
  "SAFARI":            "Place each person on an African safari wearing a light explorer hat, a calm friendly lion sitting peacefully beside them, golden savannah with acacia trees and warm sunset light in the background",
  "ASTRONAUTA":        "Dress each person in a detailed white astronaut spacesuit with the helmet held under the arm so the face stays fully visible, floating gently in outer space with planets, stars and a glowing nebula behind",
  "PIRATA":            "Dress each person as a pirate on the wooden deck of a pirate ship with a pirate coat and hat, an open treasure chest full of gold beside them, sails and stormy ocean horizon behind, adventurous cinematic lighting",
  "BUZO":              "Place each person in a scuba diving scene wearing a diving mask on the forehead so the face stays visible, surrounded by colorful tropical fish and a vibrant coral reef, bright sun rays streaming down through clear blue water",
  "PRINCESA DE HIELO": "Turn each person into elegant ice-themed royalty wearing a shimmering pale-blue crystalline gown and a delicate ice tiara, standing in a magical glittering ice palace with soft cold blue light and sparkling snowflakes",
  "SIRENA":            "Turn each person into a mermaid-themed character in an enchanted underwater kingdom, iridescent scaled tail motif, glowing seashells, pearls and soft turquoise light with gentle bubbles rising",
  "HADA DEL BOSQUE":   "Turn each person into a forest fairy with delicate translucent glowing wings and a flower crown, standing in a magical enchanted forest at dusk with floating fairy lights and soft golden bokeh",
  "REINA MEDIEVAL":    "Turn each person into medieval royalty wearing an ornate crown and a rich velvet royal robe, standing in a grand castle throne room with warm torch light, tapestries and stone columns behind",
  "HÉROE DEL TRUENO":  "Turn each person into a thunder-god superhero with glowing energy armor and crackling blue lightning around them, face fully visible with no mask, dramatic dark storm clouds and epic god-rays in the background, powerful heroic pose",
  "GUERRERA AMAZONA":  "Turn each person into an amazon warrior princess with golden armored accents and a bold headband, face fully visible, standing on an epic battlefield ridge at golden hour with a dramatic sky behind, heroic and strong",
  "HEROE NOCTURNO":    "Turn each person into a night vigilante superhero in a sleek dark suit and flowing cape, with only a small domino eye-mask that leaves most of the face clearly visible and recognizable, standing on a rooftop above a glowing nighttime city skyline under a full moon, moody blue cinematic lighting",
  "VELOCISTA":         "Turn each person into a speedster superhero in a sleek red-and-gold suit, face fully visible with no full mask, glowing lightning and motion-blur energy trails swirling around them, dynamic action background with electric sparks",
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
