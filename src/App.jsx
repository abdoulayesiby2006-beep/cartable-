import React, { useState, useRef, useEffect } from "react";

/* ---------- Supabase (connexion réelle, pas de simulation) ---------- */
const SUPABASE_URL = "https://vxmoanldvzpbdzhmxhpq.supabase.co";
const SUPABASE_KEY = "sb_publishable_EBlXRdA6_4W8cQa9kzmSXw_K2FkZQvX";

async function supaSignUp(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || "Erreur d'inscription");
  return data;
}

async function supaSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || "Identifiants incorrects");
  return data;
}

async function supaCreateProfile(accessToken, profile) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur de création du profil");
  }
  return res.json();
}

/* ---------- Scan réel : image(s) -> vrai PDF -> Supabase Storage -> table courses ---------- */
function loadJsPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf) return resolve(window.jspdf);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf);
    script.onerror = () => reject(new Error("Impossible de charger l'outil de génération PDF."));
    document.head.appendChild(script);
  });
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl: reader.result, width: img.width, height: img.height });
      img.onerror = () => reject(new Error("Image illisible."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Fichier illisible."));
    reader.readAsDataURL(file);
  });
}

async function buildPdfFromImages(images) {
  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  images.forEach((img, idx) => {
    if (idx > 0) doc.addPage();
    const ratio = Math.min(pageWidth / img.width, pageHeight / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    const x = (pageWidth - w) / 2;
    const y = (pageHeight - h) / 2;
    doc.addImage(img.dataUrl, "JPEG", x, y, w, h);
  });
  return doc.output("blob");
}

async function supaUploadPdf(accessToken, userId, blob, filename) {
  const path = `${userId}/${filename}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/course-pdfs/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/pdf",
    },
    body: blob,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Échec de l'envoi du PDF vers le stockage.");
  }
  return path;
}

async function supaCreateCourse(accessToken, course) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/courses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(course),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur lors de la publication du cours.");
  }
  return res.json();
}

function mapDbCourseToLocal(row) {
  return {
    id: row.id,
    title: row.titre,
    filiere: row.filiere,
    auteur: "Vous",
    niveau: row.niveau || "—",
    prix: row.prix_fcfa,
    pages: row.nombre_pages || 0,
    ventes: 0,
    note: 5,
    blurb: "Votre cours fraîchement scanné et publié.",
  };
}

/* ---------------------------------------------------------
   CARTABLE — marketplace de cours entre étudiants
   Palette : encre indigo, papier chaud, or "tampon", corail scan
--------------------------------------------------------- */

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

:root{
  --ink:#1B2A4A;
  --ink-light:#33456B;
  --paper:#FAF6EE;
  --paper2:#F1E9D6;
  --gold:#D79A3B;
  --coral:#E4572E;
  --green:#3A7D5C;
  --line:#DDCFAF;
}
*{box-sizing:border-box;}
.ctb-root{
  font-family:'Inter',sans-serif;
  background:var(--paper);
  color:var(--ink);
  min-height:100vh;
  position:relative;
}
.ctb-root, .ctb-root *{ scrollbar-width: thin; }
.ctb-display{ font-family:'Fraunces',serif; }
.ctb-mono{ font-family:'IBM Plex Mono',monospace; letter-spacing:0.02em; }

.ctb-btn{
  font-family:'Inter',sans-serif;
  font-weight:600;
  border:none;
  cursor:pointer;
  transition:transform .15s ease, box-shadow .15s ease, background .15s ease;
}
.ctb-btn:active{ transform:translateY(1px); }
.ctb-btn-primary{
  background:var(--ink);
  color:var(--paper);
  border-radius:999px;
  padding:12px 22px;
}
.ctb-btn-primary:hover{ background:var(--ink-light); }
.ctb-btn-gold{
  background:var(--gold);
  color:var(--ink);
  border-radius:999px;
  padding:12px 22px;
}
.ctb-btn-gold:hover{ box-shadow:0 4px 0 0 var(--ink); transform:translateY(-2px); }
.ctb-btn-outline{
  background:transparent;
  color:var(--ink);
  border:1.5px solid var(--ink);
  border-radius:999px;
  padding:10px 20px;
}
.ctb-btn-outline:hover{ background:var(--ink); color:var(--paper); }
.ctb-btn-coral{
  background:var(--coral);
  color:#fff;
  border-radius:999px;
  padding:12px 22px;
}
.ctb-btn-coral:hover{ background:#c8481f; }

.ctb-card{
  background:#fff;
  border:1px solid var(--line);
  border-radius:18px;
}
.ctb-nav-link{
  font-weight:600; font-size:14.5px; cursor:pointer; color:var(--ink-light);
  padding:8px 4px; border-bottom:2px solid transparent; transition:all .15s ease;
}
.ctb-nav-link:hover{ color:var(--ink); }
.ctb-nav-link.active{ color:var(--ink); border-bottom:2px solid var(--gold); }

/* Signature element: the peer-review "tampon" stamp */
.ctb-stamp{
  display:inline-flex; align-items:center; gap:6px;
  border:2px solid currentColor;
  border-radius:999px;
  padding:4px 12px 4px 8px;
  transform:rotate(-6deg);
  font-family:'IBM Plex Mono',monospace;
  font-weight:600;
  font-size:11px;
  text-transform:uppercase;
  letter-spacing:0.06em;
  mix-blend-mode:multiply;
  opacity:0.92;
}
.ctb-stamp-ring{
  width:16px;height:16px;border-radius:50%;border:2px solid currentColor;
  display:flex;align-items:center;justify-content:center;font-size:9px;
}

.ctb-input{
  width:100%;
  border:1.5px solid var(--line);
  background:#fff;
  border-radius:12px;
  padding:11px 14px;
  font-family:'Inter',sans-serif;
  font-size:14.5px;
  color:var(--ink);
  outline:none;
  transition:border-color .15s ease;
}
.ctb-input:focus{ border-color:var(--gold); }

.ctb-fade-in{ animation:ctbFade .5s ease both; }
@keyframes ctbFade{ from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:translateY(0);} }

.ctb-progress-track{ height:8px; border-radius:999px; background:var(--paper2); overflow:hidden; }
.ctb-progress-fill{ height:100%; background:var(--coral); border-radius:999px; transition:width .4s ease; }

.ctb-scan-box{
  border:2px dashed var(--line);
  border-radius:20px;
  transition:border-color .2s ease, background .2s ease;
}
.ctb-scan-box.drag{ border-color:var(--coral); background:#FFF4F0; }

@media (max-width: 720px){
  .ctb-hide-mobile{ display:none !important; }
  .ctb-grid-course{ grid-template-columns:1fr !important; }
  .ctb-hero-title{ font-size:38px !important; }
}
`;

/* ---------- Mock data ---------- */
const FILIERES = ["Toutes", "Droit", "Économie", "Informatique", "Médecine", "Anglais", "Maths"];

const SEED_COURSES = [
  { id: 1, title: "Droit des obligations — Semestre 3", filiere: "Droit", auteur: "Aïcha K.", niveau: "L2", prix: 2500, pages: 84, ventes: 63, note: 4.8, blurb: "Cours complet + fiches de synthèse, annoté par un major de promo." },
  { id: 2, title: "Microéconomie — Théorie du consommateur", filiere: "Économie", auteur: "Moussa D.", niveau: "L1", prix: 1500, pages: 46, ventes: 121, note: 4.6, blurb: "Graphiques refaits à la main, exercices corrigés en annexe." },
  { id: 3, title: "Algorithmique & structures de données", filiere: "Informatique", auteur: "Fatoumata S.", niveau: "L2", prix: 3000, pages: 112, ventes: 205, note: 4.9, blurb: "TD corrigés en Python, schémas de complexité inclus." },
  { id: 4, title: "Anatomie du système cardiovasculaire", filiere: "Médecine", auteur: "Ibrahim T.", niveau: "L1", prix: 3500, pages: 68, ventes: 88, note: 4.7, blurb: "Planches annotées, mnémotechniques testées en amphi." },
  { id: 5, title: "Business English — Négociation", filiere: "Anglais", auteur: "Kadiatou B.", niveau: "L3", prix: 2000, pages: 39, ventes: 54, note: 4.5, blurb: "Vocabulaire, scripts de dialogue et cas pratiques." },
  { id: 6, title: "Algèbre linéaire — Matrices & espaces vectoriels", filiere: "Maths", auteur: "Seydou C.", niveau: "L1", prix: 1800, pages: 57, ventes: 97, note: 4.6, blurb: "Démonstrations détaillées pas à pas, exercices type examen." },
  { id: 7, title: "Droit constitutionnel comparé", filiere: "Droit", auteur: "Aïcha K.", niveau: "L1", prix: 2200, pages: 71, ventes: 40, note: 4.4, blurb: "Comparatif Mali / France / Sénégal, utile pour les dissertations." },
  { id: 8, title: "Bases de données relationnelles — SQL", filiere: "Informatique", auteur: "Oumar N.", niveau: "L2", prix: 2800, pages: 65, ventes: 142, note: 4.8, blurb: "Modélisation MCD/MLD + requêtes SQL corrigées." },
];

const PAYMENT_METHODS = [
  { id: "orange", label: "Orange Money", group: "mobile" },
  { id: "moov", label: "Moov Money", group: "mobile" },
  { id: "wave", label: "Wave", group: "mobile" },
  { id: "carte", label: "Carte bancaire", group: "carte" },
];

function fmt(n) {
  return n.toLocaleString("fr-FR") + " FCFA";
}

/* ---------- Small pieces ---------- */
function Stamp({ text, color = "var(--green)", icon = "✓" }) {
  return (
    <span className="ctb-stamp" style={{ color }}>
      <span className="ctb-stamp-ring">{icon}</span>
      {text}
    </span>
  );
}

function Logo({ size = 22 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <rect x="4" y="10" width="32" height="24" rx="4" fill="var(--ink)" />
        <rect x="10" y="4" width="8" height="10" rx="2" fill="var(--gold)" />
        <rect x="22" y="4" width="8" height="10" rx="2" fill="var(--coral)" />
        <line x1="4" y1="20" x2="36" y2="20" stroke="var(--paper)" strokeWidth="1.5" opacity="0.5" />
      </svg>
      <span className="ctb-display" style={{ fontWeight: 700, fontSize: 21 }}>Cartable</span>
    </div>
  );
}

function StarRow({ note }) {
  return (
    <span className="ctb-mono" style={{ fontSize: 12, color: "var(--ink-light)" }}>
      ★ {note.toFixed(1)}
    </span>
  );
}

/* ---------- Course card ---------- */
function CourseCard({ course, onOpen, onAdd, inCart }) {
  return (
    <div
      className="ctb-card ctb-fade-in"
      style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}
      onClick={() => onOpen(course)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span
          className="ctb-mono"
          style={{
            fontSize: 11,
            background: "var(--paper2)",
            padding: "3px 9px",
            borderRadius: 999,
            color: "var(--ink-light)",
            fontWeight: 600,
          }}
        >
          {course.filiere} · {course.niveau}
        </span>
        {course.ventes > 100 && <Stamp text="Populaire" color="var(--coral)" icon="★" />}
      </div>
      <h3 className="ctb-display" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.25, margin: 0 }}>
        {course.title}
      </h3>
      <p style={{ fontSize: 13.5, color: "var(--ink-light)", margin: 0, lineHeight: 1.5 }}>{course.blurb}</p>
      <div style={{ fontSize: 12.5, color: "var(--ink-light)", display: "flex", gap: 10 }}>
        <span>{course.auteur}</span>
        <span>·</span>
        <span>{course.pages} pages</span>
        <span>·</span>
        <StarRow note={course.note} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <span className="ctb-mono" style={{ fontSize: 17, fontWeight: 700 }}>{fmt(course.prix)}</span>
        <button
          className="ctb-btn ctb-btn-outline"
          style={{ fontSize: 13, padding: "8px 16px" }}
          onClick={(e) => { e.stopPropagation(); onAdd(course); }}
        >
          {inCart ? "Ajouté ✓" : "Ajouter au panier"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Views ---------- */
function Home({ go, courses }) {
  const top = courses.slice(0, 3);
  return (
    <div>
      <section style={{ padding: "72px 6vw 56px", display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, alignItems: "center" }}>
        <div className="ctb-fade-in">
          <span className="ctb-mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700, letterSpacing: "0.08em" }}>
            LE MARCHÉ DES COURS ENTRE ÉTUDIANTS
          </span>
          <h1 className="ctb-display ctb-hero-title" style={{ fontSize: 54, lineHeight: 1.05, margin: "14px 0 20px", fontWeight: 700 }}>
            Le cartable qui <span style={{ color: "var(--coral)" }}>rapporte</span>.
          </h1>
          <p style={{ fontSize: 16.5, color: "var(--ink-light)", maxWidth: 480, lineHeight: 1.6 }}>
            Scannez vos meilleurs cours, vendez-les à d'autres étudiants en quelques minutes,
            et achetez ceux qui vous manquent. Simple, sérieux, entre étudiants.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            <button className="ctb-btn ctb-btn-primary" onClick={() => go("catalog")}>Parcourir le catalogue</button>
            <button className="ctb-btn ctb-btn-coral" onClick={() => go("scan")}>📷 Scanner un cours</button>
          </div>
          <div style={{ display: "flex", gap: 22, marginTop: 34 }}>
            <div>
              <div className="ctb-display" style={{ fontSize: 26, fontWeight: 700 }}>810+</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-light)" }}>cours en vente</div>
            </div>
            <div>
              <div className="ctb-display" style={{ fontSize: 26, fontWeight: 700 }}>90%</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-light)" }}>reversés au vendeur</div>
            </div>
            <div>
              <div className="ctb-display" style={{ fontSize: 26, fontWeight: 700 }}>4.7★</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-light)" }}>note moyenne</div>
            </div>
          </div>
        </div>
        <div className="ctb-fade-in ctb-hide-mobile" style={{ position: "relative", height: 380 }}>
          <div style={{ position: "absolute", top: 0, right: 20, width: 230, transform: "rotate(4deg)" }} className="ctb-card">
            <div style={{ padding: 16 }}>
              <span className="ctb-mono" style={{ fontSize: 10, color: "var(--ink-light)" }}>DROIT · L2</span>
              <h4 className="ctb-display" style={{ fontSize: 15, margin: "6px 0" }}>Droit des obligations</h4>
              <Stamp text="Certifié pairs" />
            </div>
          </div>
          <div style={{ position: "absolute", top: 90, left: 10, width: 240, transform: "rotate(-5deg)" }} className="ctb-card">
            <div style={{ padding: 16 }}>
              <span className="ctb-mono" style={{ fontSize: 10, color: "var(--ink-light)" }}>INFO · L2</span>
              <h4 className="ctb-display" style={{ fontSize: 15, margin: "6px 0" }}>Algorithmique & structures</h4>
              <Stamp text="Populaire" color="var(--coral)" icon="★" />
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 0, right: 40, width: 220, transform: "rotate(-2deg)" }} className="ctb-card">
            <div style={{ padding: 16 }}>
              <span className="ctb-mono" style={{ fontSize: 10, color: "var(--ink-light)" }}>ÉCO · L1</span>
              <h4 className="ctb-display" style={{ fontSize: 15, margin: "6px 0" }}>Microéconomie</h4>
              <Stamp text="Certifié pairs" />
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "40px 6vw 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <h2 className="ctb-display" style={{ fontSize: 26, fontWeight: 600 }}>Les mieux notés</h2>
          <span className="ctb-nav-link" onClick={() => go("catalog")}>Voir tout le catalogue →</span>
        </div>
        <div className="ctb-grid-course" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
          {top.map((c) => (
            <CourseCard key={c.id} course={c} onOpen={(course) => go("course", course)} onAdd={() => {}} />
          ))}
        </div>
      </section>

      <section style={{ background: "var(--ink)", color: "var(--paper)", padding: "60px 6vw" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }} className="ctb-grid-course">
          <div>
            <div className="ctb-mono" style={{ color: "var(--gold)", fontSize: 13 }}>01 — SCANNEZ</div>
            <h3 className="ctb-display" style={{ fontSize: 20, margin: "10px 0" }}>Vos cours en PDF</h3>
            <p style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.6 }}>Photographiez vos pages, on les transforme en PDF propre et compressé, prêt à vendre.</p>
          </div>
          <div>
            <div className="ctb-mono" style={{ color: "var(--gold)", fontSize: 13 }}>02 — FIXEZ VOTRE PRIX</div>
            <h3 className="ctb-display" style={{ fontSize: 20, margin: "10px 0" }}>Vous gardez 90%</h3>
            <p style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.6 }}>Cartable prélève seulement 10% de commission sur chaque vente. Le reste est à vous.</p>
          </div>
          <div>
            <div className="ctb-mono" style={{ color: "var(--gold)", fontSize: 13 }}>03 — ENCAISSEZ</div>
            <h3 className="ctb-display" style={{ fontSize: 20, margin: "10px 0" }}>Carte ou Mobile Money</h3>
            <p style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.6 }}>Vos acheteurs paient par carte bancaire, Orange Money, Moov Money ou Wave.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Catalog({ go, courses, cart, onAdd }) {
  const [filiere, setFiliere] = useState("Toutes");
  const [q, setQ] = useState("");
  const filtered = courses.filter(
    (c) => (filiere === "Toutes" || c.filiere === filiere) && c.title.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div style={{ padding: "40px 6vw 80px" }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 32, fontWeight: 700, marginBottom: 6 }}>Catalogue</h1>
      <p style={{ color: "var(--ink-light)", marginBottom: 24 }}>{filtered.length} cours disponibles</p>
      <div style={{ display: "flex", gap: 14, marginBottom: 26, flexWrap: "wrap" }}>
        <input
          className="ctb-input"
          style={{ maxWidth: 320 }}
          placeholder="Rechercher un cours…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FILIERES.map((f) => (
            <button
              key={f}
              onClick={() => setFiliere(f)}
              className="ctb-btn"
              style={{
                borderRadius: 999,
                padding: "8px 16px",
                fontSize: 13,
                border: "1.5px solid var(--line)",
                background: filiere === f ? "var(--ink)" : "#fff",
                color: filiere === f ? "var(--paper)" : "var(--ink)",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="ctb-grid-course" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {filtered.map((c) => (
          <CourseCard
            key={c.id}
            course={c}
            onOpen={(course) => go("course", course)}
            onAdd={onAdd}
            inCart={cart.some((x) => x.id === c.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p style={{ color: "var(--ink-light)" }}>Aucun cours ne correspond à cette recherche.</p>
        )}
      </div>
    </div>
  );
}

function CourseDetail({ course, onAdd, inCart, go }) {
  if (!course) return null;
  return (
    <div style={{ padding: "44px 6vw 80px", maxWidth: 820 }} className="ctb-fade-in">
      <span className="ctb-nav-link" onClick={() => go("catalog")}>← Retour au catalogue</span>
      <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <span className="ctb-mono" style={{ fontSize: 12, color: "var(--ink-light)" }}>
            {course.filiere} · {course.niveau}
          </span>
          <h1 className="ctb-display" style={{ fontSize: 32, fontWeight: 700, margin: "8px 0" }}>{course.title}</h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center", color: "var(--ink-light)", fontSize: 14 }}>
            <span>Par {course.auteur}</span>
            <span>·</span>
            <StarRow note={course.note} />
            <span>·</span>
            <span>{course.ventes} ventes</span>
          </div>
        </div>
        <Stamp text="Certifié par les pairs" />
      </div>

      <p style={{ marginTop: 24, fontSize: 15.5, lineHeight: 1.7, color: "var(--ink-light)" }}>{course.blurb}</p>

      <div className="ctb-card" style={{ padding: 24, marginTop: 28, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="ctb-mono" style={{ fontSize: 26, fontWeight: 700 }}>{fmt(course.prix)}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-light)" }}>PDF · {course.pages} pages · téléchargement immédiat</div>
        </div>
        <button className="ctb-btn ctb-btn-primary" onClick={() => onAdd(course)}>
          {inCart ? "Déjà dans le panier ✓" : "Ajouter au panier"}
        </button>
      </div>
    </div>
  );
}

function ScanCourse({ addUploadedCourse, go, currentUser, accessToken, onRequireLogin }) {
  const [step, setStep] = useState("upload"); // upload -> form -> processing -> done -> error
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [scanLabelIdx, setScanLabelIdx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [filiere, setFiliere] = useState("Informatique");
  const [prix, setPrix] = useState(2000);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const scanLabels = ["Lecture des pages", "Génération du PDF", "Envoi vers le stockage", "Publication du cours"];

  function pickFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    setFiles(arr);
    setStep("form");
  }

  async function publish() {
    setError("");
    setStep("processing");
    setProgress(5);
    setScanLabelIdx(0);
    try {
      const images = [];
      for (let i = 0; i < files.length; i++) {
        images.push(await readImageFile(files[i]));
        setProgress(5 + Math.round(((i + 1) / files.length) * 30));
      }
      setScanLabelIdx(1);
      const pdfBlob = await buildPdfFromImages(images);
      setProgress(60);
      setScanLabelIdx(2);
      const filename = `cours-${Date.now()}.pdf`;
      const path = await supaUploadPdf(accessToken, currentUser.id, pdfBlob, filename);
      setProgress(85);
      setScanLabelIdx(3);
      const created = await supaCreateCourse(accessToken, {
        vendeur_id: currentUser.id,
        titre: title || "Cours scanné sans titre",
        filiere,
        prix_fcfa: Number(prix) || 0,
        nombre_pages: images.length,
        pdf_url: path,
        statut: "publie",
      });
      setProgress(100);
      addUploadedCourse(mapDbCourseToLocal(created[0]));
      setStep("done");
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }

  if (!currentUser) {
    return (
      <div style={{ padding: "90px 6vw", textAlign: "center" }} className="ctb-fade-in">
        <p style={{ fontWeight: 600, marginBottom: 16, fontSize: 16 }}>
          Connectez-vous pour scanner et publier un cours.
        </p>
        <button className="ctb-btn ctb-btn-primary" onClick={onRequireLogin}>Se connecter</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 640 }} className="ctb-fade-in">
      <span className="ctb-mono" style={{ fontSize: 12, color: "var(--coral)", fontWeight: 700, letterSpacing: "0.06em" }}>
        VENDRE UN COURS
      </span>
      <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 700, margin: "8px 0 26px" }}>
        Scannez votre cours en PDF
      </h1>

      {step === "upload" && (
        <div
          className={"ctb-scan-box" + (dragging ? " drag" : "")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pickFiles(e.dataTransfer.files); }}
          style={{ padding: "56px 24px", textAlign: "center", cursor: "pointer" }}
          onClick={() => fileInput.current?.click()}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>Glissez vos photos de pages ici</p>
          <p style={{ fontSize: 13, color: "var(--ink-light)", marginBottom: 20 }}>
            ou utilisez l'appareil photo — chaque photo devient une page du PDF
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="ctb-btn ctb-btn-coral" onClick={(e) => { e.stopPropagation(); fileInput.current?.click(); }}>
              📷 Prendre en photo
            </button>
            <button className="ctb-btn ctb-btn-outline" onClick={(e) => { e.stopPropagation(); fileInput.current?.click(); }}>
              Choisir des fichiers
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: "none" }}
            onChange={(e) => pickFiles(e.target.files)}
          />
        </div>
      )}

      {step === "form" && (
        <div className="ctb-card" style={{ padding: 28 }}>
          <Stamp text={files.length + " page(s) prête(s)"} />
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Titre du cours</span>
              <input className="ctb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Thermodynamique — Chapitre 2" />
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Filière</span>
              <select className="ctb-input" value={filiere} onChange={(e) => setFiliere(e.target.value)}>
                {FILIERES.filter((f) => f !== "Toutes").map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Prix de vente (FCFA)</span>
              <input className="ctb-input" type="number" value={prix} onChange={(e) => setPrix(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--ink-light)" }}>
                Vous recevrez {fmt(Math.round(prix * 0.9))} par vente (commission Cartable : 10%)
              </span>
            </label>
            <button className="ctb-btn ctb-btn-primary" style={{ marginTop: 6 }} onClick={publish}>
              Générer le PDF et publier
            </button>
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="ctb-card" style={{ padding: 32 }}>
          <p style={{ fontWeight: 600, marginBottom: 18 }}>{scanLabels[scanLabelIdx]}…</p>
          <div className="ctb-progress-track">
            <div className="ctb-progress-fill" style={{ width: progress + "%" }} />
          </div>
          <p className="ctb-mono" style={{ fontSize: 12, marginTop: 10, color: "var(--ink-light)" }}>{progress}%</p>
        </div>
      )}

      {step === "error" && (
        <div className="ctb-card" style={{ padding: 32 }}>
          <p style={{ fontWeight: 600, color: "var(--coral)", marginBottom: 8 }}>Ça a échoué :</p>
          <p style={{ fontSize: 13.5, color: "var(--ink-light)", marginBottom: 20 }}>{error}</p>
          <button className="ctb-btn ctb-btn-outline" onClick={() => setStep("form")}>Réessayer</button>
        </div>
      )}

      {step === "done" && (
        <div className="ctb-card" style={{ padding: 32, textAlign: "center" }}>
          <Stamp text="Publié avec succès" />
          <h3 className="ctb-display" style={{ fontSize: 22, margin: "16px 0 8px" }}>Votre cours est en ligne</h3>
          <p style={{ color: "var(--ink-light)", fontSize: 14, marginBottom: 22 }}>
            Le PDF est stocké en sécurité et le cours est enregistré dans votre base de données.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="ctb-btn ctb-btn-outline" onClick={() => { setStep("upload"); setFiles([]); setTitle(""); setPrix(2000); }}>
              Scanner un autre cours
            </button>
            <button className="ctb-btn ctb-btn-primary" onClick={() => go("dashboard")}>Voir mon espace</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({ uploaded, go }) {
  const totalVentes = uploaded.reduce((s, c) => s + c.ventes, 0);
  const totalBrut = uploaded.reduce((s, c) => s + c.ventes * c.prix, 0);
  const commission = Math.round(totalBrut * 0.1);
  const net = totalBrut - commission;
  return (
    <div style={{ padding: "44px 6vw 90px" }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 700, marginBottom: 24 }}>Mon espace vendeur</h1>

      <div className="ctb-grid-course" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        <div className="ctb-card" style={{ padding: 20 }}>
          <div className="ctb-mono" style={{ fontSize: 11, color: "var(--ink-light)" }}>REVENUS BRUTS</div>
          <div className="ctb-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{fmt(totalBrut)}</div>
        </div>
        <div className="ctb-card" style={{ padding: 20 }}>
          <div className="ctb-mono" style={{ fontSize: 11, color: "var(--coral)" }}>COMMISSION CARTABLE (10%)</div>
          <div className="ctb-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--coral)" }}>− {fmt(commission)}</div>
        </div>
        <div className="ctb-card" style={{ padding: 20, background: "var(--ink)", borderColor: "var(--ink)" }}>
          <div className="ctb-mono" style={{ fontSize: 11, color: "var(--gold)" }}>VOS GAINS NETS (90%)</div>
          <div className="ctb-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--paper)" }}>{fmt(net)}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 className="ctb-display" style={{ fontSize: 20, fontWeight: 600 }}>Mes cours publiés</h2>
        <button className="ctb-btn ctb-btn-coral" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => go("scan")}>
          📷 Scanner un nouveau cours
        </button>
      </div>

      {uploaded.length === 0 ? (
        <div className="ctb-card" style={{ padding: 32, textAlign: "center", color: "var(--ink-light)" }}>
          Vous n'avez encore publié aucun cours. C'est une invitation, pas un problème — lancez le scanner.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {uploaded.map((c) => (
            <div key={c.id} className="ctb-card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.title}</div>
                <div className="ctb-mono" style={{ fontSize: 11.5, color: "var(--ink-light)" }}>{c.filiere} · {c.ventes} ventes</div>
              </div>
              <div className="ctb-mono" style={{ fontWeight: 700 }}>{fmt(c.prix)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cart({ cart, onRemove, go, onCheckout }) {
  const total = cart.reduce((s, c) => s + c.prix, 0);
  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 640 }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 700, marginBottom: 24 }}>Panier</h1>
      {cart.length === 0 ? (
        <div className="ctb-card" style={{ padding: 32, textAlign: "center", color: "var(--ink-light)" }}>
          Votre panier est vide.
          <div style={{ marginTop: 16 }}>
            <button className="ctb-btn ctb-btn-primary" onClick={() => go("catalog")}>Parcourir le catalogue</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {cart.map((c) => (
              <div key={c.id} className="ctb-card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.title}</div>
                  <div className="ctb-mono" style={{ fontSize: 11.5, color: "var(--ink-light)" }}>{c.filiere}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span className="ctb-mono" style={{ fontWeight: 700 }}>{fmt(c.prix)}</span>
                  <span style={{ cursor: "pointer", color: "var(--coral)", fontSize: 13 }} onClick={() => onRemove(c.id)}>Retirer</span>
                </div>
              </div>
            ))}
          </div>
          <div className="ctb-card" style={{ padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="ctb-display" style={{ fontSize: 20, fontWeight: 700 }}>Total : {fmt(total)}</span>
            <button className="ctb-btn ctb-btn-primary" onClick={onCheckout}>Passer au paiement</button>
          </div>
        </>
      )}
    </div>
  );
}

function Checkout({ cart, go, onPaid }) {
  const total = cart.reduce((s, c) => s + c.prix, 0);
  const [method, setMethod] = useState("orange");
  const [phase, setPhase] = useState("select"); // select -> paying -> done
  const selected = PAYMENT_METHODS.find((m) => m.id === method);

  function pay() {
    setPhase("paying");
    setTimeout(() => { setPhase("done"); onPaid(); }, 1400);
  }

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 560 }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 28, fontWeight: 700, marginBottom: 22 }}>Paiement</h1>

      {phase === "select" && (
        <>
          <div className="ctb-card" style={{ padding: 20, marginBottom: 20 }}>
            <span className="ctb-mono" style={{ fontSize: 11, color: "var(--ink-light)" }}>MONTANT À PAYER</span>
            <div className="ctb-display" style={{ fontSize: 28, fontWeight: 700 }}>{fmt(total)}</div>
          </div>

          <p style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Mobile Money</p>
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
            {PAYMENT_METHODS.filter((m) => m.group === "mobile").map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className="ctb-btn"
                style={{
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 13.5,
                  border: method === m.id ? "2px solid var(--ink)" : "1.5px solid var(--line)",
                  background: "#fff",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Carte bancaire</p>
          <button
            onClick={() => setMethod("carte")}
            className="ctb-btn"
            style={{
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 13.5,
              border: method === "carte" ? "2px solid var(--ink)" : "1.5px solid var(--line)",
              background: "#fff",
              marginBottom: 22,
            }}
          >
            Visa / Mastercard
          </button>

          {selected?.group === "mobile" ? (
            <div className="ctb-card" style={{ padding: 18, marginBottom: 22 }}>
              <label>
                <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Numéro {selected.label}
                </span>
                <input className="ctb-input" placeholder="+223 XX XX XX XX" />
              </label>
            </div>
          ) : (
            <div className="ctb-card" style={{ padding: 18, marginBottom: 22, display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Numéro de carte</span>
                <input className="ctb-input" placeholder="0000 0000 0000 0000" />
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Expiration</span>
                  <input className="ctb-input" placeholder="MM/AA" />
                </label>
                <label style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>CVC</span>
                  <input className="ctb-input" placeholder="123" />
                </label>
              </div>
            </div>
          )}

          <button className="ctb-btn ctb-btn-primary" style={{ width: "100%", padding: "14px" }} onClick={pay}>
            Payer {fmt(total)}
          </button>
        </>
      )}

      {phase === "paying" && (
        <div className="ctb-card" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ fontWeight: 600 }}>Traitement du paiement via {selected?.label}…</p>
          <div className="ctb-progress-track" style={{ marginTop: 18 }}>
            <div className="ctb-progress-fill" style={{ width: "100%", transition: "width 1.2s ease" }} />
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="ctb-card" style={{ padding: 36, textAlign: "center" }}>
          <Stamp text="Paiement confirmé" />
          <h3 className="ctb-display" style={{ fontSize: 22, margin: "16px 0 8px" }}>Merci pour votre achat</h3>
          <p style={{ color: "var(--ink-light)", fontSize: 14, marginBottom: 22 }}>
            Vos PDF sont disponibles au téléchargement immédiatement.
          </p>
          <button className="ctb-btn ctb-btn-primary" onClick={() => go("catalog")}>Retour au catalogue</button>
        </div>
      )}
    </div>
  );
}

function AuthModal({ onClose, onAuthed }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nom, setNom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!email.includes("@") || !email.includes(".")) {
      setError("Entrez une adresse e-mail valide.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const data = await supaSignUp(email, password);
        const token = data.access_token;
        const user = data.user;
        if (token && user) {
          try {
            await supaCreateProfile(token, { id: user.id, nom_complet: nom || email.split("@")[0] });
          } catch (profileErr) {
            // le compte est créé même si le profil échoue ; on continue
          }
          onAuthed(user, token);
        } else {
          setError("Compte créé. Vérifiez votre e-mail pour le confirmer, puis connectez-vous.");
          setMode("login");
        }
      } else {
        const data = await supaSignIn(email, password);
        onAuthed(data.user, data.access_token);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(27,42,74,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div className="ctb-card" style={{ padding: 30, width: 360, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <h3 className="ctb-display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          {mode === "login" ? "Connexion" : "Créer un compte"}
        </h3>
        <p style={{ fontSize: 13, color: "var(--ink-light)", marginBottom: 18 }}>
          {mode === "login" ? "Retrouvez vos cours et vos ventes." : "Rejoignez Cartable en quelques secondes."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" && (
            <input className="ctb-input" placeholder="Nom complet" value={nom} onChange={(e) => setNom(e.target.value)} />
          )}
          <input className="ctb-input" type="text" placeholder="Adresse e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="ctb-input"
            type="password"
            placeholder="Mot de passe (6 caractères min.)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
          />
          {error && (
            <p style={{ color: "#fff", background: "var(--coral)", padding: "10px 14px", borderRadius: 10, fontSize: 13, margin: 0, fontWeight: 600 }}>
              ⚠️ {error}
            </p>
          )}
          <button className="ctb-btn ctb-btn-primary" disabled={loading} onClick={submit}>
            {loading ? "Un instant…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
          </button>
        </div>
        <p style={{ fontSize: 12.5, marginTop: 14, textAlign: "center", color: "var(--ink-light)" }}>
          {mode === "login" ? "Pas encore de compte ?" : "Déjà un compte ?"}{" "}
          <span
            style={{ color: "var(--ink)", fontWeight: 600, cursor: "pointer" }}
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
          >
            {mode === "login" ? "S'inscrire" : "Se connecter"}
          </span>
        </p>
      </div>
    </div>
  );
}

/* ---------- App ---------- */
export default function App() {
  const [view, setView] = useState("home");
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [cart, setCart] = useState([]);
  const [uploaded, setUploaded] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const allCourses = [...SEED_COURSES, ...uploaded];

  function handleAuthed(user, token) {
    setCurrentUser(user);
    setAccessToken(token);
    setShowAuthModal(false);
  }
  function handleSignOut() {
    setCurrentUser(null);
    setAccessToken(null);
  }

  function go(v, course) {
    if (course) setSelectedCourse(course);
    setView(v);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function addToCart(course) {
    setCart((c) => (c.some((x) => x.id === course.id) ? c : [...c, course]));
  }
  function removeFromCart(id) {
    setCart((c) => c.filter((x) => x.id !== id));
  }
  function addUploadedCourse(course) {
    setUploaded((u) => [{ ...course, ventes: Math.floor(Math.random() * 6) }, ...u]);
  }

  const navItems = [
    ["home", "Accueil"],
    ["catalog", "Catalogue"],
    ["scan", "Scanner un cours"],
    ["dashboard", "Mon espace"],
  ];

  return (
    <div className="ctb-root">
      <style>{FONTS}</style>

      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(250,246,238,0.92)", backdropFilter: "blur(6px)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ padding: "14px 6vw", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ cursor: "pointer" }} onClick={() => go("home")}><Logo /></div>
          <nav style={{ display: "flex", gap: 26 }} className="ctb-hide-mobile">
            {navItems.map(([id, label]) => (
              <span key={id} className={"ctb-nav-link" + (view === id ? " active" : "")} onClick={() => go(id)}>
                {label}
              </span>
            ))}
          </nav>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="ctb-btn ctb-btn-outline" style={{ padding: "8px 16px", fontSize: 13, position: "relative" }} onClick={() => go("cart")}>
              🛒 Panier {cart.length > 0 && (
                <span className="ctb-mono" style={{ marginLeft: 6, background: "var(--coral)", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11 }}>
                  {cart.length}
                </span>
              )}
            </button>
            {currentUser ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="ctb-mono ctb-hide-mobile" style={{ fontSize: 12, color: "var(--ink-light)" }}>
                  {currentUser.email}
                </span>
                <button className="ctb-btn ctb-btn-outline" style={{ padding: "8px 14px", fontSize: 13 }} onClick={handleSignOut}>
                  Déconnexion
                </button>
              </div>
            ) : (
              <button className="ctb-btn ctb-btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setShowAuthModal(true)}>
                Connexion
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        {view === "home" && <Home go={go} courses={allCourses} />}
        {view === "catalog" && <Catalog go={go} courses={allCourses} cart={cart} onAdd={addToCart} />}
        {view === "course" && (
          <CourseDetail
            course={selectedCourse}
            onAdd={addToCart}
            inCart={cart.some((x) => x.id === selectedCourse?.id)}
            go={go}
          />
        )}
        {view === "scan" && (
          <ScanCourse
            addUploadedCourse={addUploadedCourse}
            go={go}
            currentUser={currentUser}
            accessToken={accessToken}
            onRequireLogin={() => setShowAuthModal(true)}
          />
        )}
        {view === "dashboard" &&
          (currentUser ? (
            <Dashboard uploaded={uploaded} go={go} />
          ) : (
            <div style={{ padding: "90px 6vw", textAlign: "center" }} className="ctb-fade-in">
              <p style={{ fontWeight: 600, marginBottom: 16, fontSize: 16 }}>
                Connectez-vous pour accéder à votre espace vendeur.
              </p>
              <button className="ctb-btn ctb-btn-primary" onClick={() => setShowAuthModal(true)}>
                Se connecter
              </button>
            </div>
          ))}
        {view === "cart" && <Cart cart={cart} onRemove={removeFromCart} go={go} onCheckout={() => go("checkout")} />}
        {view === "checkout" && <Checkout cart={cart} go={go} onPaid={() => setCart([])} />}
      </main>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onAuthed={handleAuthed} />}

      <footer style={{ borderTop: "1px solid var(--line)", padding: "36px 6vw", marginTop: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <Logo size={18} />
          <span style={{ fontSize: 12.5, color: "var(--ink-light)" }}>
            © 2026 Cartable — Le marché des cours entre étudiants.
          </span>
        </div>
      </footer>
    </div>
  );
}
