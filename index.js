const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cors({ origin: (origin, cb) => cb(null, true) }));

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;
const VERSION = "ia-v4 · medidas validas + reintentos + 0x0";

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
  " IMPORTANT: keep this EXACTLY like the original everyday photo — same framing and composition, " +
  "same camera angle and zoom, same background. Do NOT crop, zoom, rotate or move the person, and do NOT " +
  "shift anyone to the side. Keep every person exactly as they are — the same faces, bodies, clothes, hair, " +
  "skin tone, age and gender, and the same number of people — do NOT restyle, costume or change anyone. " +
  "Only add the described object, placed naturally in one of the person's hands, photorealistic and matching " +
  "the photo's lighting and perspective.";

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
  "MAMADERA":       "Add a big funny oversized baby bottle held naturally in one of the person's hands.",
  "ESPADA":         "Add an epic glowing fantasy sword held naturally in one of the person's hands.",
  "WHISKY":         "Add a big oversized bottle of whisky held naturally in one of the person's hands, humorous party vibe.",
  "DINOSAURIO":     "Make it look like the person is holding a small friendly cartoon baby dinosaur in their arms.",
  "MICROFONO":      "Add a shiny stage microphone held naturally in one of the person's hands, as if they are singing.",
  "TROFEO":         "Add a big golden champion trophy held up in one of the person's hands.",
  "RAMO DE FLORES": "Add a big beautiful bouquet of flowers held naturally in one of the person's hands.",
  "GUITARRA":       "Add a cool electric guitar held naturally in the person's hands.",
};

// ---- CARICATURAS (modo propio) ----
// Caricatura de la cara: exagera rasgos pero la persona se reconoce.
const REGLA_CARICATURA =
  " Make it a caricature of THIS person's face: exaggerate the most distinctive features in a fun, " +
  "flattering way, but keep the person clearly recognizable (same hair, same general look). " +
  "One person, centered portrait. Clean, high quality.";

const CARICATURAS = {
  "CARICATURA LINEA": "Black-and-white hand-drawn line caricature, like a street caricature artist: a big expressive head on a small body, confident black ink pen strokes, plain white background, a small handwritten signature at the bottom.",
  "CARICATURA COLOR": "Colorful hand-drawn caricature with a big head and small body, exaggerated friendly features, soft shading and clean coloring, simple light studio background.",
  "CARICATURA 3D":    "Cute 3D animated Pixar-style caricature, big expressive eyes and stylized exaggerated features, soft studio lighting, simple pleasant background.",
};

// ---- ACCESORIOS (cabina clásica, foto de 1): sumar un accesorio simpático ----
const REGLA_ACCESORIO =
  " IMPORTANT: keep this EXACTLY like the original photo — same framing and composition, same camera angle and zoom, " +
  "same background. Do NOT crop, zoom, rotate or move the person, and do NOT shift anyone to the side. " +
  "Keep the person(s) exactly (same faces, bodies, clothes, age, gender, and the same number of people). " +
  "Only add the described item in a fun, natural, photorealistic way, matching the lighting.";
const ACCESORIOS = {
  "GORRO":  "Add a fun colorful party hat on top of the person's head.",
  "LENTES": "Add cool stylish sunglasses on the person's face.",
  "CORONA": "Add a shiny golden crown on top of the person's head.",
};

// ---- EFECTOS (cabina clásica, foto de 3: solo la última, divertido) ----
const REGLA_EFECTO =
  " Apply this as a fun, eye-catching style to the WHOLE photo, keeping the same framing and composition " +
  "(do NOT crop, zoom or move the person), and keep the person(s) clearly recognizable (same faces, same pose, " +
  "same number of people). High quality.";
const EFECTOS = {
  "COMIC":          "Turn the photo into a fun comic-book / pop-art style: bold black outlines, bright flat colors and halftone dots, like a comic panel.",
  "DIBUJO ANIMADO": "Turn the photo into a fun cartoon / animated style with clean outlines and bright cheerful colors.",
  "POP ART":        "Turn the photo into a vibrant Andy-Warhol-style pop-art with bright flat high-contrast colors.",
  "VINTAGE":        "Turn the photo into a warm vintage look: soft sepia tones, gentle film grain and an old-photo feel, but still clearly the person.",
};

const MODELO = "gemini-2.5-flash-image";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Mide el ancho y alto reales de la foto (JPEG o PNG) a partir del dataURL,
// así generamos en el MISMO formato (vertical/horizontal) y la persona no se
// corre al costado ni se recorta.
function medirImagen(dataUrl) {
  try {
    const base64 = dataUrl.split(",")[1];
    const buf = Buffer.from(base64, "base64");
    // PNG: firma + IHDR con ancho/alto en big-endian
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // JPEG: busco el marcador SOF (donde vienen alto y ancho)
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o < buf.length - 9) {
        if (buf[o] !== 0xff) { o++; continue; }
        const marker = buf[o + 1];
        // Marcadores SOF (tamaño de la imagen), evitando los que no lo son
        if (marker >= 0xc0 && marker <= 0xcf &&
            marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
        }
        const len = buf.readUInt16BE(o + 2);
        if (len <= 0) break;
        o += 2 + len;
      }
    }
  } catch (e) {}
  return null;
}

// Medidas que ACEPTA el modelo gemini-2.5-flash-image en Leonardo.
// Elegimos la más parecida al formato de la foto (vertical / cuadrada / horizontal).
// Solo medidas que Leonardo acepta SIEMPRE (están en todas las listas que devuelve).
const TAMANOS = [
  { W: 768,  H: 1344 }, // 0.571  vertical muy alta (9:16 aprox)
  { W: 832,  H: 1248 }, // 0.667  vertical 2:3
  { W: 768,  H: 1024 }, // 0.750  vertical 3:4 (típica de celular)
  { W: 896,  H: 1152 }, // 0.778  vertical
  { W: 864,  H: 1024 }, // 0.844  vertical suave
  { W: 896,  H: 896  }, // 1.000  cuadrada
  { W: 1184, H: 896  }, // 1.321  horizontal 4:3 aprox
  { W: 1248, H: 896  }, // 1.393  horizontal
  { W: 1184, H: 672  }, // 1.762  horizontal ancha (16:9 aprox)
  { W: 1248, H: 672  }, // 1.857  horizontal muy ancha
];

// Calcula el tamaño de salida eligiendo la medida VÁLIDA más cercana al
// formato real de la foto (así no se corre ni se recorta la persona).
function calcularTamano(dataUrl) {
  const dim = medirImagen(dataUrl);
  if (!dim || !dim.w || !dim.h) return { W: 896, H: 896 };
  const ar = dim.w / dim.h;
  let best = TAMANOS[0], diff = Infinity;
  for (const t of TAMANOS) {
    const d = Math.abs((t.W / t.H) - ar);
    if (d < diff) { diff = d; best = t; }
  }
  return { W: best.W, H: best.H };
}

app.get("/", (_req, res) => res.send("Servidor SIS Eventos IA — OK — " + VERSION));

app.post("/generar", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const { cara, personaje } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) return res.status(400).json({ error: "Falta la foto" });
    let instruccion = null;
    if (PERSONAJES[personaje])         instruccion = PERSONAJES[personaje] + REGLA_PERSONAS;
    else if (OBJETOS[personaje])       instruccion = OBJETOS[personaje] + REGLA_OBJETOS;
    else if (CARICATURAS[personaje])   instruccion = CARICATURAS[personaje] + REGLA_CARICATURA;
    else if (ACCESORIOS[personaje])    instruccion = ACCESORIOS[personaje] + REGLA_ACCESORIO;
    else if (EFECTOS[personaje])       instruccion = EFECTOS[personaje] + REGLA_EFECTO;
    if (!instruccion) return res.status(400).json({ error: "Personaje desconocido: " + personaje });

    const tam = calcularTamano(cara);
    const idImagen = await subirCara(cara);
    const genId = await pedirGeneracion(idImagen, instruccion, tam);
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

// Devuelve el valor de la lista más cercano al deseado.
function masCercano(lista, valor) {
  let best = lista[0], diff = Infinity;
  for (const v of lista) { const d = Math.abs(v - valor); if (d < diff) { diff = d; best = v; } }
  return best;
}

// Saca el generationId de cualquiera de las formas que devuelve Leonardo.
function sacarGenId(d) {
  return (d.generate && d.generate.generationId) ||
    (d.sdGenerationJob && d.sdGenerationJob.generationId) ||
    (d.generations_by_pk && d.generations_by_pk.id) ||
    (d.generation && d.generation.id) ||
    (d.data && d.data.id) ||
    d.generationId || d.id || null;
}

// Un intento de generación. Devuelve { genId } si salió, o { permitidosW, permitidosH }
// si Leonardo rechazó la medida (para reintentar), o {} si falló por otra cosa.
async function intentarGeneracion(idImagen, instruccion, W, H) {
  const r = await fetch(`${LEONARDO}/v2/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO,
      public: false,
      parameters: {
        prompt: instruccion,
        negative_prompt: NEGATIVO,
        width: W,
        height: H,
        prompt_enhance: "OFF",
        guidances: { image_reference: [ { image: { id: idImagen, type: "UPLOADED" } } ] },
      },
    }),
  });
  const texto = await r.text();
  console.log("RESPUESTA LEONARDO (" + W + "x" + H + ", status " + r.status + "):", texto);
  let d = {};
  try { d = JSON.parse(texto); } catch (e) {}
  const genId = sacarGenId(d);
  if (genId) return { genId };
  // ¿La rechazó por la medida? Leonardo lista las medidas válidas para ESTA foto.
  const mW = texto.match(/width must be one of:\s*([0-9,\s]+)/i);
  const mH = texto.match(/height must be one of:\s*([0-9,\s]+)/i);
  if (mW && mH) {
    const permitidosW = mW[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
    const permitidosH = mH[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
    if (permitidosW.length && permitidosH.length) return { permitidosW, permitidosH };
  }
  return {};
}

async function pedirGeneracion(idImagen, instruccion, tam) {
  let W = (tam && tam.W) || 896;
  let H = (tam && tam.H) || 896;
  // Hasta 4 intentos: Leonardo cambia la lista de medidas válidas en cada
  // llamada, así que si rechaza, reajusto a lo que diga y vuelvo a probar.
  for (let intento = 0; intento < 4; intento++) {
    const res = await intentarGeneracion(idImagen, instruccion, W, H);
    if (res.genId) return res.genId;
    if (res.permitidosW && res.permitidosH) {
      W = masCercano(res.permitidosW, W);
      H = masCercano(res.permitidosH, H);
      console.log("Reintento con medida:", W + "x" + H);
      continue;
    }
    break; // si el error no es por la medida, no tiene sentido insistir
  }
  // Red de seguridad: medida automática (0x0 siempre está permitido) para que
  // el modelo elija el tamaño según la foto y nunca quede en 500.
  console.log("Ultimo recurso: medida automatica 0x0");
  const auto = await intentarGeneracion(idImagen, instruccion, 0, 0);
  if (auto.genId) return auto.genId;
  throw new Error("no vino el id de generacion");
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
app.listen(PORT, () => console.log("Servidor SIS Eventos IA (" + VERSION + ") escuchando en " + PORT));
