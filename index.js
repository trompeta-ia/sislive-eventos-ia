const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cors({ origin: (origin, cb) => cb(null, true) }));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;

// Negative prompt (lo que NO queremos). Igual que la versión que funcionaba.
const NEGATIVO = "deformed, distorted face, disfigured, extra limbs, extra fingers, mutated hands, bad anatomy, blurry, low quality, low resolution, watermark, text, logo, ugly, creepy, duplicate, cropped face, changed identity, extra people, missing people, face mask covering face, club crest, team logo, emblem";

// Regla común a TODOS los personajes: respeta la identidad real de cada persona
// y le pone a cada uno la versión de su propio género y edad. Así el grupo mixto
// (y la foto de una persona) salen bien en una sola pasada.
const REGLA_PERSONAS =
  " IMPORTANT: this photo may contain one or more people. Keep every real person exactly: " +
  "the same faces, the same number of people, and each person's own skin tone, age and gender — " +
  "never change anyone's gender or age, and never add or remove real people. " +
  "When the theme includes a costume or character look, give EACH person individually the version that matches " +
  "THEIR OWN gender and age: men and boys get the masculine version, women and girls get the feminine version, " +
  "and children get a child-appropriate version. You may add themed background characters, animals or props as described. " +
  "Natural and flattering, high quality, photorealistic.";

// Regla para los OBJETOS (QR mágico): NO disfraza a nadie, mantiene la foto
// normal y solo mete el objeto en la mano de quien levanta la cartita.
const REGLA_OBJETOS =
  " IMPORTANT: keep this looking like the real everyday photo. Keep every person exactly as they are — " +
  "the same faces, bodies, clothes, hair, skin tone, age and gender, and the same number of people — " +
  "do NOT restyle, costume or change anyone. Only add the described object, placed naturally in the hand " +
  "of whoever is holding up a small card or raising their hand (replacing that card). Make the object " +
  "fun and photorealistic, matching the photo's lighting and perspective.";

const PERSONAJES = {
  "MURGUISTA":         "Turn each person into a colorful Uruguayan carnival murga performer with a bright striped costume and painted carnival face, on a festive stage with warm lighting.",
  "CANDOMBERO":        "Turn each person into an Uruguayan candombe carnival performer with a tambor drum, in a warm nighttime street-carnival atmosphere with glowing lanterns.",
  "GAUCHO":            "Place everyone in a rural Uruguayan pampa at sunset and dress each person in traditional countryside attire: men and boys as gauchos with hat, neckerchief and poncho, women and girls as 'chinas'/paisanas in traditional country dresses.",
  "HINCHA CELESTE":    "Surround everyone with a festive sky-blue and white Uruguay football-supporters celebration: confetti, flags, scarves and a stadium atmosphere, with celebratory supporter gear for each person.",
  "SAFARI":            "Place everyone in an African safari scene with golden savannah light and a friendly lion sitting calmly nearby; dress each person as a safari explorer.",
  "ASTRONAUTA":        "Place everyone in a space scene floating among planets and stars; dress each person in an astronaut spacesuit with the helmet visible.",
  "PIRATA":            "Place everyone on the wooden deck of a pirate ship with an open treasure chest and the ocean behind, adventurous cinematic lighting; dress each person as a pirate with hats and coats.",
  "BUZO":              "Place everyone in an underwater diving scene with colorful fish and coral reef and sun rays through the water; dress each person in scuba diving gear.",
  "PRINCESA DE HIELO": "Transform the scene into a magical ice palace with sparkling snow, ice crystals and cold blue lighting; dress each person in royal ice-palace attire: women and girls as elegant ice princesses with crystal tiaras and icy gowns, men and boys as ice kings or princes with frosted crowns and royal cloaks.",
  "SIRENA":            "Place everyone in an enchanted underwater kingdom with glowing seashells and soft light; give each person a sea-royalty look: women and girls as mermaids with shimmering tails, men and boys as mermen or sea princes.",
  "HADA DEL BOSQUE":   "Surround everyone with a magical enchanted forest with glowing fairy lights and soft dreamy lighting; give each person a woodland look: women and girls as forest fairies with delicate translucent wings, men and boys as forest elves or sprites.",
  "REINA MEDIEVAL":    "Place everyone in a medieval castle throne room with warm torch lighting; dress each person as medieval royalty: women and girls as queens or princesses with elegant crowns and gowns, men and boys as kings or princes with crowns and royal mantles.",
  "HÉROE DEL TRUENO":  "Surround everyone with a dramatic thunder-god theme with lightning, storm clouds and glowing energy, epic cinematic lighting; give each person armor and glowing energy: men and boys as thunder gods, women and girls as thunder goddesses.",
  "GUERRERA AMAZONA":  "Surround everyone with an epic warrior theme on a battlefield sky with heroic light and golden armor accents; give each person a warrior look: women and girls as amazon warrior princesses, men and boys as heroic warriors.",
  "SOMBRA NOCTURNA":   "Surround everyone with a dark masked night-hero theme over a dramatic nighttime city skyline with moody blue light; dress each person as a sleek masked night hero with a cape.",
  "VELOCISTA":         "Surround everyone with a speedster superhero theme with motion-blur energy trails and glowing lightning, dynamic cinematic light; dress each person in a sleek speedster suit.",
};

// ---- OBJETOS (QR mágico): la cartita se transforma en un objeto en la mano ----
// La foto queda normal; solo aparece el objeto. Sirve para foto de 1 o de varios.
const OBJETOS = {
  "MAMADERA":       "Add a huge funny oversized baby bottle held in the person's raised hand (replacing the small card).",
  "ESPADA":         "Add an epic glowing fantasy sword held in the person's raised hand (replacing the small card).",
  "WHISKY":         "Add a giant oversized bottle of whisky held in the person's raised hand (replacing the small card), humorous party vibe.",
  "DINOSAURIO":     "Make it look like the person is holding and lifting up a small friendly cartoon baby dinosaur in their arms (replacing the small card they were holding).",
  "MICROFONO":      "Add a shiny stage microphone held in the person's raised hand (replacing the small card), as if they are singing.",
  "TROFEO":         "Add a big golden champion trophy raised in the person's hand (replacing the small card).",
  "RAMO DE FLORES": "Add a big beautiful bouquet of flowers held in the person's raised hand (replacing the small card).",
  "GUITARRA":       "Add a cool electric guitar held in the person's hands (replacing the small card).",
};

const MODELO = "gemini-2.5-flash-image";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (_req, res) => res.send("Servidor SIS Eventos IA — OK"));

app.post("/generar", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const { cara, personaje } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) return res.status(400).json({ error: "Falta la foto" });
    let instruccion = null;
    if (PERSONAJES[personaje])     instruccion = PERSONAJES[personaje] + REGLA_PERSONAS;
    else if (OBJETOS[personaje])   instruccion = OBJETOS[personaje] + REGLA_OBJETOS;
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
      model: MODELO,
      public: false,
      parameters: {
        prompt: instruccion,
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
