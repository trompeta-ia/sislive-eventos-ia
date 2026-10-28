const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const FFMPEG = require("ffmpeg-static");   // binario de ffmpeg incluido (no hace falta instalarlo en Render)

const app = express();
app.use(express.json({ limit: "12mb" }));

// ---- SEGURIDAD ----
// Token compartido con el espejo. Se puede cambiar poniendo APP_TOKEN en Render.
const TOKEN = process.env.APP_TOKEN || "sis-espejo-7q2m9x4k";
// CORS: solo el dominio del espejo (y localhost para pruebas). Otros dominios: bloqueados.
const ORIGENES_OK = [
  "https://sis-eventos.web.app",
  "https://sis-eventos.firebaseapp.com"
];
app.use(cors({ origin: (origin, cb) => {
  if (!origin) return cb(null, true);                                   // curl / health / apps sin origen
  if (ORIGENES_OK.includes(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
  return cb(null, false);                                               // dominio no permitido
} }));

// Límite simple por IP: frena que alguien dispare miles de pedidos y te queme créditos.
const golpesPorIP = new Map();
function limitarIP(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  const ahora = Date.now(), ventana = 60 * 1000, maximo = 30;
  const reg = golpesPorIP.get(ip) || { t: ahora, n: 0 };
  if (ahora - reg.t > ventana) { reg.t = ahora; reg.n = 0; }
  reg.n++; golpesPorIP.set(ip, reg);
  if (reg.n > maximo) return res.status(429).json({ error: "Demasiados pedidos, esperá un minuto" });
  next();
}
// Token: rechaza cualquier pedido que no traiga la llave correcta.
function chequearToken(req, res, next) {
  const t = req.headers["x-app-token"] || (req.body && req.body.token);
  if (t !== TOKEN) return res.status(403).json({ error: "No autorizado" });
  next();
}

const LEONARDO = "https://cloud.leonardo.ai/api/rest";
const KEY = process.env.LEONARDO_API_KEY;
const VERSION = "ia-v10 · 360 pro + portada de revista";

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

// Regla para CARICATURAS DE FAMOSOS (biblioteca): el prompt dice "caricature ...".
// Mantiene a la persona reconocible pero en estilo caricatura/dibujo (NO realista),
// y permite dibujar al famoso/personaje al lado, en el mismo estilo.
const REGLA_CARICATURA_FAMOSO =
  " Draw EVERY real person in this photo as a fun, flattering caricature that still looks clearly like them " +
  "(same face, hair, skin tone, age and gender — never change anyone's gender or age, and never add or remove real people). " +
  "Render the WHOLE image in one consistent hand-drawn caricature / cartoon style, NOT photorealistic. " +
  "Draw the described famous character next to them in the same caricature style. Cheerful, flattering and high quality.";

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

// ---- PORTADA DE REVISTA ----
// La IA hace la PINTA de tapa de revista (persona como modelo de portada) y DEJA
// lugar arriba y en los costados para el texto. El texto (nombre de la revista y
// frases) lo pone el espejo con canvas, para que salga nítido y diga lo que queremos.
const REGLA_REVISTA =
  " IMPORTANT: keep every real person exactly — the same faces, the same number of people, and each " +
  "person's own skin tone, age and gender (never change anyone's gender or age, never add or remove people). " +
  "Turn the shot into a professional, glossy MAGAZINE COVER photo of the person: confident cover-model pose, " +
  "editorial studio lighting, high-end retouching, vertical cover framing. Leave clear EMPTY SPACE at the TOP " +
  "for a magazine title, and clean margins on the sides for cover lines. Do NOT draw any text, letters, numbers, " +
  "words, captions or logos anywhere — keep those areas clean. Photorealistic, flattering, high quality.";
const REVISTAS = {
  "REVISTA MODA":      "High-fashion glossy magazine cover look (Vogue / Elle style): elegant and chic styling, trendy editorial fashion wardrobe and makeup, soft luxury studio background.",
  "REVISTA DEPORTES":  "Sports magazine cover look: athletic, energetic and powerful, dynamic sporty styling and lighting, stadium or gym editorial background, strong confident hero pose.",
  "REVISTA FARANDULA": "Celebrity entertainment magazine cover look: red-carpet glamour, bright flashy showbiz styling, star-quality charisma, glamorous spotlight background.",
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

// Saldo / crédito de Leonardo (para ver cuánto queda antes de un evento)
app.get("/credito", chequearToken, async (_req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const r = await fetch(`${LEONARDO}/v1/me`, { headers: { authorization: `Bearer ${KEY}` } });
    const texto = await r.text();
    if (!r.ok) return res.status(500).json({ error: "Leonardo " + r.status, detalle: texto });
    let d = {}; try { d = JSON.parse(texto); } catch (e) {}
    const u = (d.user_details && d.user_details[0]) || {};
    const pagos = Number(u.apiPaidTokens || 0);
    const plan = Number(u.apiSubscriptionTokens || 0);
    return res.status(200).json({
      ok: true,
      tokensPagos: pagos,
      tokensPlan: plan,
      tokensTotal: pagos + plan,
      costoPorFoto: 0.0389,   // US$ por generación aprox.
      renovacion: u.apiPlanTokenRenewalDate || u.paidTokenRenewalDate || u.tokenRenewalDate || null,
      detalle: u              // por si cambian los nombres de los campos
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/generar", limitarIP, chequearToken, async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "Falta LEONARDO_API_KEY" });
    const { cara, personaje, prompt } = req.body || {};
    if (!cara || !cara.startsWith("data:image/")) return res.status(400).json({ error: "Falta la foto" });
    let instruccion = null;
    if (PERSONAJES[personaje])         instruccion = PERSONAJES[personaje] + REGLA_PERSONAS;
    else if (OBJETOS[personaje])       instruccion = OBJETOS[personaje] + REGLA_OBJETOS;
    else if (CARICATURAS[personaje])   instruccion = CARICATURAS[personaje] + REGLA_CARICATURA;
    else if (ACCESORIOS[personaje])    instruccion = ACCESORIOS[personaje] + REGLA_ACCESORIO;
    else if (EFECTOS[personaje])       instruccion = EFECTOS[personaje] + REGLA_EFECTO;
    else if (REVISTAS[personaje])      instruccion = REVISTAS[personaje] + REGLA_REVISTA;
    // Personaje de la biblioteca (no es de los fijos): usa el prompt que se
    // configuró en el administrador para ESE personaje. Así cualquier personaje
    // nuevo funciona sin tocar el servidor.
    else if (prompt && String(prompt).trim()) {
      const p = String(prompt).trim();
      // Si el prompt es de caricatura (famosos), usa la regla de caricatura en vez de la realista.
      instruccion = p + (/caricatur/i.test(p) ? REGLA_CARICATURA_FAMOSO : REGLA_PERSONAS);
    }
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

// =====================================================================
//  EDITOR DE VIDEO 360 (flow motion PRO): lento -> boomerang -> lento
//  El celular sube el video crudo a Cloudinary y nos manda la URL.
//  Acá lo bajamos, lo editamos por tramos, le pegamos la musica adentro
//  del archivo y tu logo, lo subimos a Cloudinary y devolvemos la URL final.
// =====================================================================
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD || "dki0l2b9";
const CLOUD_PRESET = process.env.CLOUDINARY_PRESET || "espejo_sis";
const LOGO_TEXTO = process.env.LOGO_360 || "%40sislive.uy";   // @sislive.uy
const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
const ESCALA = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

// Corre ffmpeg y espera a que termine.
function correrFF(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 1024 * 1024 * 64 }, (err, _out, stderr) => {
      if (err) return reject(new Error("ffmpeg: " + String(stderr || err.message).slice(-600)));
      resolve(stderr || "");
    });
  });
}
// Duracion de un video leyendo el stderr de ffmpeg (no hace falta ffprobe).
function duracionVideo(file) {
  return new Promise((resolve) => {
    execFile(FFMPEG, ["-i", file], (_e, _o, stderr) => {
      const m = String(stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
    });
  });
}
// Baja un archivo (video o musica) de una URL a disco.
async function bajarArchivo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("descarga " + r.status);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
// Sube el video terminado a Cloudinary (mismo preset sin firma que usa el celular).
async function subirCloudinary(file) {
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/mp4" }), "video360.mp4");
  form.append("upload_preset", CLOUD_PRESET);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, { method: "POST", body: form });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.secure_url) throw new Error("cloudinary " + ((d.error && d.error.message) || r.status));
  return d.secure_url;
}

// El corazon del asunto: arma el video por tramos con distintas velocidades.
async function armar360(raw, music, out, trabajo) {
  const D = await duracionVideo(raw);
  if (!D || D < 2) throw new Error("video ilegible o muy corto (D=" + D + ")");

  // Limites proporcionales a la duracion real (anda grabe 10, 12 o 15s).
  const b1 = +(D * 0.30).toFixed(2);   // tramo 1: LENTO
  const b2 = +(D * 0.47).toFixed(2);   // tramo 2: BOOMERANG
  const b3 = +(D * 0.78).toFixed(2);   // tramo 3: LENTO
  const d1 = b1, d2 = +(b2 - b1).toFixed(2), d3 = +(b3 - b2).toFixed(2);

  const s1 = path.join(trabajo, "s1.mp4");
  const s2 = path.join(trabajo, "s2.mp4");
  const s3 = path.join(trabajo, "s3.mp4");

  // Tramo 1 — LENTO (0.5x)
  await correrFF(["-y", "-ss", "0", "-t", String(d1), "-i", raw,
    "-vf", `setpts=2.0*(PTS-STARTPTS),fps=30,${ESCALA}`, "-an", ...ENC, s1]);
  // Tramo 2 — BOOMERANG (ida + vuelta)
  await correrFF(["-y", "-ss", String(b1), "-t", String(d2), "-i", raw,
    "-filter_complex", `[0:v]setpts=(PTS-STARTPTS),fps=30,${ESCALA},split=2[f][r];[r]reverse[rr];[f][rr]concat=n=2:v=1:a=0[v]`,
    "-map", "[v]", "-an", ...ENC, s2]);
  // Tramo 3 — LENTO (0.5x)
  await correrFF(["-y", "-ss", String(b2), "-t", String(d3), "-i", raw,
    "-vf", `setpts=2.0*(PTS-STARTPTS),fps=30,${ESCALA}`, "-an", ...ENC, s3]);

  const totalOut = (await duracionVideo(s1)) + (await duracionVideo(s2)) + (await duracionVideo(s3));
  const stFade = Math.max(0.1, totalOut - 1).toFixed(2);
  const dur = Math.max(1, totalOut).toFixed(2);

  const lista = path.join(trabajo, "lista.txt");
  fs.writeFileSync(lista, [s1, s2, s3].map(f => `file '${f.replace(/'/g, "")}'`).join("\n"));

  // Junta los tramos (copia el video ya codificado = rapido) y pega la musica.
  if (music) {
    await correrFF(["-y", "-f", "concat", "-safe", "0", "-i", lista,
      "-stream_loop", "-1", "-i", music,
      "-filter_complex", `[1:a]afade=t=in:d=0.6,afade=t=out:st=${stFade}:d=1,volume=1.0[a]`,
      "-map", "0:v", "-c:v", "copy", "-map", "[a]", "-c:a", "aac", "-b:a", "160k",
      "-t", dur, "-movflags", "+faststart", out]);
  } else {
    await correrFF(["-y", "-f", "concat", "-safe", "0", "-i", lista,
      "-map", "0:v", "-c:v", "copy", "-an", "-t", dur, "-movflags", "+faststart", out]);
  }
  return { D, totalOut };
}

app.post("/procesar360", limitarIP, chequearToken, async (req, res) => {
  const { videoUrl, musicaUrl } = req.body || {};
  if (!videoUrl || !/^https?:\/\//.test(videoUrl)) return res.status(400).json({ error: "falta videoUrl" });
  const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), "v360-"));
  try {
    const raw = path.join(trabajo, "raw");
    await bajarArchivo(videoUrl, raw);

    let music = null;
    if (musicaUrl && /^https?:\/\//.test(musicaUrl)) {
      try { music = path.join(trabajo, "musica.mp3"); await bajarArchivo(musicaUrl, music); }
      catch (e) { music = null; }   // si falla la musica, igual armamos el video
    }

    const out = path.join(trabajo, "final.mp4");
    const info = await armar360(raw, music, out, trabajo);
    const url = await subirCloudinary(out);
    console.log("procesar360 OK:", info, "->", url);
    return res.status(200).json({ url, duracion: info.totalOut });
  } catch (e) {
    console.error("procesar360 ERROR:", e.message);
    return res.status(500).json({ error: "No se pudo procesar el video 360" });
  } finally {
    try { fs.rmSync(trabajo, { recursive: true, force: true }); } catch (e) {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor SIS Eventos IA (" + VERSION + ") escuchando en " + PORT));
