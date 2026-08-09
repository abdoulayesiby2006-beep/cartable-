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
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur de création du profil");
  }
  return res.json();
}

async function supaGetProfile(accessToken, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

async function supaUpdateProfile(accessToken, userId, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur lors de la mise à jour du profil.");
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
  const details = [row.universite, row.pays].filter(Boolean).join(" · ");
  return {
    id: row.id,
    vendeur_id: row.vendeur_id,
    isReal: true,
    title: row.titre,
    type_annonce: row.type_annonce || "cours",
    filiere: row.filiere,
    auteur: "Vous",
    niveau: row.niveau || "—",
    prix: row.prix_fcfa,
    pages: row.nombre_pages || 0,
    ventes: 0,
    note: 5,
    blurb:
      row.description ||
      (row.matiere ? `${row.matiere}${details ? " — " + details : ""}` : details || "Votre annonce fraîchement publiée."),
  };
}

/* ---------- Filières vivantes : liste alimentée par les étudiants ---------- */
async function supaListFilieres() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/filieres?select=nom&order=nom.asc`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((r) => r.nom);
}

async function supaAddFiliere(accessToken, nom) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/filieres`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ nom }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur lors de l'ajout de la filière.");
  }
  return res.json();
}

/* ---------- Mes achats ---------- */
async function supaListPurchases(accessToken) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?select=*,courses(titre,type_annonce,pdf_url)&statut_paiement=eq.paye&order=cree_le.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  return res.json();
}

async function supaGetDownloadUrl(accessToken, purchaseId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-download-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ purchase_id: purchaseId }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || "Impossible de générer le lien de téléchargement.");
  return data.url;
}


/* ---------------------------------------------------------
   CARTABLE — marketplace de cours entre étudiants
   Palette : encre indigo, papier chaud, or "tampon", corail scan
--------------------------------------------------------- */

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

:root{
  --ink:#0F172A;
  --ink-light:#64748B;
  --paper:#F8FAFC;
  --paper2:#EEF3FF;
  --gold:#000091;
  --coral:#000091;
  --error:#DC2626;
  --green:#16A34A;
  --line:#E2E8F0;
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
.ctb-display{ font-family:'Manrope',sans-serif; color:var(--gold); letter-spacing:-0.01em; }
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
  background:var(--gold);
  color:#fff;
  border-radius:10px;
  padding:12px 22px;
  box-shadow:0 1px 2px rgba(37,99,235,0.25);
}
.ctb-btn-primary:hover{ background:#1D4ED8; }
.ctb-btn-gold{
  background:var(--gold);
  color:#fff;
  border-radius:10px;
  padding:12px 22px;
}
.ctb-btn-gold:hover{ background:#1D4ED8; }
.ctb-btn-outline{
  background:#fff;
  color:var(--gold);
  border:1.5px solid var(--line);
  border-radius:10px;
  padding:10px 20px;
}
.ctb-btn-outline:hover{ border-color:var(--gold); background:var(--paper2); }
.ctb-btn-coral{
  background:var(--gold);
  color:#fff;
  border-radius:10px;
  padding:12px 22px;
}
.ctb-btn-coral:hover{ background:#1D4ED8; }

.ctb-card{
  background:#fff;
  border:1px solid var(--line);
  border-radius:14px;
  box-shadow:0 1px 3px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.03);
}
.ctb-nav-link{
  font-weight:600; font-size:14.5px; cursor:pointer; color:var(--ink-light);
  padding:8px 4px; border-bottom:2px solid transparent; transition:all .15s ease;
}
.ctb-nav-link:hover{ color:var(--gold); }
.ctb-nav-link.active{ color:var(--gold); border-bottom:2px solid var(--gold); }

/* Signature element: clean verification badge */
.ctb-stamp{
  display:inline-flex; align-items:center; gap:6px;
  background:var(--paper2);
  border-radius:999px;
  padding:4px 12px 4px 8px;
  font-family:'Inter',sans-serif;
  font-weight:600;
  font-size:11.5px;
  letter-spacing:0.01em;
}
.ctb-stamp-ring{
  width:16px;height:16px;border-radius:50%;background:currentColor;
  display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;
}

.ctb-input{
  width:100%;
  border:1.5px solid var(--line);
  background:#fff;
  border-radius:10px;
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
.ctb-progress-fill{ height:100%; background:var(--gold); border-radius:999px; transition:width .4s ease; }

.ctb-scan-box{
  border:2px dashed var(--line);
  border-radius:16px;
  transition:border-color .2s ease, background .2s ease;
}
.ctb-scan-box.drag{ border-color:var(--gold); background:var(--paper2); }

.ctb-mobile-menu-btn{ display:none; }
.ctb-mobile-panel{ display:none; }

@media (max-width: 720px){
  .ctb-hide-mobile{ display:none !important; }
  .ctb-grid-course{ grid-template-columns:1fr !important; }
  .ctb-hero-title{ font-size:38px !important; }
  .ctb-mobile-menu-btn{ display:flex !important; }
  .ctb-mobile-panel.open{ display:flex !important; }
}
`;

/* ---------- Mock data ---------- */
const FILIERES = ["Toutes", "Droit", "Économie", "Informatique", "Médecine", "Anglais", "Maths"];

const COUNTRIES = [
  "Afghanistan","Afrique du Sud","Albanie","Algérie","Allemagne","Andorre","Angola","Arabie saoudite","Argentine","Arménie",
  "Australie","Autriche","Azerbaïdjan","Bahamas","Bahreïn","Bangladesh","Barbade","Belgique","Belize","Bénin",
  "Bhoutan","Biélorussie","Birmanie","Bolivie","Bosnie-Herzégovine","Botswana","Brésil","Brunei","Bulgarie","Burkina Faso",
  "Burundi","Cambodge","Cameroun","Canada","Cap-Vert","Chili","Chine","Chypre","Colombie","Comores",
  "Congo-Brazzaville","Congo-Kinshasa","Corée du Nord","Corée du Sud","Costa Rica","Côte d'Ivoire","Croatie","Cuba","Danemark","Djibouti",
  "Dominique","Égypte","Émirats arabes unis","Équateur","Érythrée","Espagne","Estonie","Eswatini","États-Unis","Éthiopie",
  "Fidji","Finlande","France","Gabon","Gambie","Géorgie","Ghana","Grèce","Grenade","Guatemala",
  "Guinée","Guinée-Bissau","Guinée équatoriale","Guyana","Haïti","Honduras","Hongrie","Îles Marshall","Îles Salomon","Inde",
  "Indonésie","Irak","Iran","Irlande","Islande","Israël","Italie","Jamaïque","Japon","Jordanie",
  "Kazakhstan","Kenya","Kirghizistan","Kiribati","Koweït","Laos","Lesotho","Lettonie","Liban","Liberia",
  "Libye","Liechtenstein","Lituanie","Luxembourg","Macédoine du Nord","Madagascar","Malaisie","Malawi","Maldives","Mali",
  "Malte","Maroc","Maurice","Mauritanie","Mexique","Micronésie","Moldavie","Monaco","Mongolie","Monténégro",
  "Mozambique","Namibie","Nauru","Népal","Nicaragua","Niger","Nigeria","Norvège","Nouvelle-Zélande","Oman",
  "Ouganda","Ouzbékistan","Pakistan","Palaos","Palestine","Panama","Papouasie-Nouvelle-Guinée","Paraguay","Pays-Bas","Pérou",
  "Philippines","Pologne","Portugal","Qatar","République centrafricaine","République dominicaine","République tchèque","Roumanie","Royaume-Uni","Russie",
  "Rwanda","Saint-Kitts-et-Nevis","Saint-Marin","Saint-Vincent-et-les-Grenadines","Sainte-Lucie","Salvador","Samoa","São Tomé-et-Principe","Sénégal","Serbie",
  "Seychelles","Sierra Leone","Singapour","Slovaquie","Slovénie","Somalie","Soudan","Soudan du Sud","Sri Lanka","Suède",
  "Suisse","Suriname","Syrie","Tadjikistan","Tanzanie","Tchad","Thaïlande","Timor oriental","Togo","Tonga",
  "Trinité-et-Tobago","Tunisie","Turkménistan","Turquie","Tuvalu","Ukraine","Uruguay","Vanuatu","Vatican","Venezuela",
  "Viêt Nam","Yémen","Zambie","Zimbabwe",
];

const TYPES = [
  { id: "cours", label: "Cours", icon: "📚", desc: "Notes de cours et fiches scannées en PDF" },
  { id: "livre", label: "Livres", icon: "📖", desc: "Livres et manuels scannés en PDF" },
  { id: "service", label: "Services", icon: "🛠️", desc: "Tutorat, relecture, aide aux devoirs..." },
];

const SEED_COURSES = [
  { id: 1, title: "Droit des obligations — Semestre 3", type_annonce: "cours", filiere: "Droit", auteur: "Aïcha K.", niveau: "L2", prix: 2500, pages: 84, ventes: 63, note: 4.8, blurb: "Cours complet + fiches de synthèse, annoté par un major de promo." },
  { id: 2, title: "Microéconomie — Théorie du consommateur", type_annonce: "cours", filiere: "Économie", auteur: "Moussa D.", niveau: "L1", prix: 1500, pages: 46, ventes: 121, note: 4.6, blurb: "Graphiques refaits à la main, exercices corrigés en annexe." },
  { id: 3, title: "Algorithmique & structures de données", type_annonce: "cours", filiere: "Informatique", auteur: "Fatoumata S.", niveau: "L2", prix: 3000, pages: 112, ventes: 205, note: 4.9, blurb: "TD corrigés en Python, schémas de complexité inclus." },
  { id: 4, title: "Anatomie du système cardiovasculaire", type_annonce: "cours", filiere: "Médecine", auteur: "Ibrahim T.", niveau: "L1", prix: 3500, pages: 68, ventes: 88, note: 4.7, blurb: "Planches annotées, mnémotechniques testées en amphi." },
  { id: 5, title: "Business English — Négociation", type_annonce: "cours", filiere: "Anglais", auteur: "Kadiatou B.", niveau: "L3", prix: 2000, pages: 39, ventes: 54, note: 4.5, blurb: "Vocabulaire, scripts de dialogue et cas pratiques." },
  { id: 6, title: "Algèbre linéaire — Matrices & espaces vectoriels", type_annonce: "cours", filiere: "Maths", auteur: "Seydou C.", niveau: "L1", prix: 1800, pages: 57, ventes: 97, note: 4.6, blurb: "Démonstrations détaillées pas à pas, exercices type examen." },
  { id: 7, title: "Droit constitutionnel comparé", type_annonce: "cours", filiere: "Droit", auteur: "Aïcha K.", niveau: "L1", prix: 2200, pages: 71, ventes: 40, note: 4.4, blurb: "Comparatif Mali / France / Sénégal, utile pour les dissertations." },
  { id: 8, title: "Bases de données relationnelles — SQL", type_annonce: "cours", filiere: "Informatique", auteur: "Oumar N.", niveau: "L2", prix: 2800, pages: 65, ventes: 142, note: 4.8, blurb: "Modélisation MCD/MLD + requêtes SQL corrigées." },
  { id: 9, title: "Manuel de microéconomie (édition complète)", type_annonce: "livre", filiere: "Économie", auteur: "Bibliothèque FSEG", niveau: "L1-L2", prix: 4000, pages: 312, ventes: 22, note: 4.7, blurb: "Manuel de référence scanné intégralement, très demandé en début de semestre." },
  { id: 10, title: "Code civil annoté", type_annonce: "livre", filiere: "Droit", auteur: "Bibliothèque Droit", niveau: "Toutes années", prix: 3500, pages: 480, ventes: 35, note: 4.9, blurb: "Édition annotée avec la jurisprudence récente, format PDF consultable hors-ligne." },
  { id: 11, title: "Aide aux devoirs — Mathématiques L1/L2", type_annonce: "service", filiere: "Maths", auteur: "Seydou C.", niveau: "L1-L2", prix: 3000, pages: 0, ventes: 18, note: 4.8, blurb: "Séance de tutorat individuel d'une heure, en visio ou en présentiel selon la ville." },
  { id: 12, title: "Relecture et correction de mémoire", type_annonce: "service", filiere: "Anglais", auteur: "Kadiatou B.", niveau: "Toutes années", prix: 5000, pages: 0, ventes: 9, note: 4.9, blurb: "Relecture orthographique et stylistique de votre mémoire, jusqu'à 40 pages." },
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

/* ---------- Devise automatique selon le pays du visiteur ---------- */
const ZERO_DECIMAL_CURRENCIES = new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]);
const XOF_PER_EUR = 655.957; // parité fixe garantie par la France, jamais changeante

const CurrencyContext = React.createContext({ code: "XOF", rate: 1 });

function useCurrency() {
  const { code, rate } = React.useContext(CurrencyContext);
  function fmt(amountXof) {
    if (code === "XOF" || !rate || rate === 1) {
      return amountXof.toLocaleString("fr-FR") + " FCFA";
    }
    const converted = amountXof * rate;
    try {
      return new Intl.NumberFormat("fr-FR", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(converted);
    } catch {
      return amountXof.toLocaleString("fr-FR") + " FCFA";
    }
  }
  return { code, rate, fmt };
}

function useCurrencyDetection() {
  const [currency, setCurrency] = useState({ code: "XOF", rate: 1 });
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      try {
        const geoRes = await fetch("https://ipapi.co/json/");
        const geo = await geoRes.json();
        const detected = geo?.currency;
        if (!detected || detected === "XOF" || cancelled) return;
        let rate;
        if (detected === "EUR") {
          rate = 1 / XOF_PER_EUR;
        } else {
          const fxRes = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${detected}`);
          const fx = await fxRes.json();
          const eurToTarget = fx?.rates?.[detected];
          if (!eurToTarget) return;
          rate = (1 / XOF_PER_EUR) * eurToTarget;
        }
        if (!cancelled) setCurrency({ code: detected, rate });
      } catch {
        // pas grave : on reste affiché en FCFA par défaut
      }
    }
    detect();
    return () => { cancelled = true; };
  }, []);
  return currency;
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

function AbstractShapes() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="xMaxYMid slice" style={{ position: "absolute", inset: 0, opacity: 0.9 }}>
      <rect x="300" y="10" width="34" height="34" rx="6" fill="#5B8DEF" opacity="0.6" />
      <rect x="345" y="55" width="26" height="26" rx="6" fill="#EF9F5B" opacity="0.7" />
      <circle cx="365" cy="20" r="14" fill="#7ED4C4" opacity="0.7" />
      <path d="M300 90 L330 90 L330 120 Z" fill="#F2C879" opacity="0.7" />
      <rect x="250" y="100" width="24" height="24" rx="5" fill="#fff" opacity="0.25" transform="rotate(20 262 112)" />
      <rect x="220" y="20" width="20" height="20" rx="5" fill="#fff" opacity="0.2" transform="rotate(-15 230 30)" />
    </svg>
  );
}

function Illustration({ kind, size = 64 }) {
  const scenes = {
    scan: (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <rect x="10" y="6" width="30" height="40" rx="3" fill="#fff" opacity="0.95" />
        <line x1="16" y1="16" x2="34" y2="16" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="16" y1="24" x2="34" y2="24" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
        <line x1="16" y1="32" x2="28" y2="32" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
        <rect x="26" y="30" width="30" height="26" rx="4" fill="var(--gold)" />
        <circle cx="41" cy="43" r="7" fill="#fff" opacity="0.9" />
        <circle cx="41" cy="43" r="3.4" fill="var(--gold)" />
        <rect x="34" y="32" width="4" height="4" rx="1" fill="#fff" />
      </svg>
    ),
    catalog: (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <rect x="8" y="14" width="20" height="26" rx="3" fill="#fff" opacity="0.95" transform="rotate(-8 18 27)" />
        <rect x="24" y="10" width="20" height="30" rx="3" fill="#fff" />
        <line x1="29" y1="18" x2="39" y2="18" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="29" y1="24" x2="39" y2="24" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
        <circle cx="44" cy="42" r="11" fill="none" stroke="var(--gold)" strokeWidth="3.2" />
        <line x1="52" y1="50" x2="59" y2="57" stroke="var(--gold)" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    ),
    sell: (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="30" r="22" fill="#fff" opacity="0.15" />
        <circle cx="32" cy="30" r="17" fill="#fff" opacity="0.95" />
        <text x="32" y="37" textAnchor="middle" fontSize="16" fontWeight="800" fill="var(--gold)">%</text>
        <path d="M14 50c4-6 32-6 36 0" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      </svg>
    ),
    cours: (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <rect x="12" y="10" width="40" height="30" rx="4" fill="#fff" opacity="0.95" />
        <line x1="18" y1="18" x2="46" y2="18" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="18" y1="25" x2="46" y2="25" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
        <line x1="18" y1="32" x2="34" y2="32" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
        <rect x="12" y="44" width="40" height="6" rx="3" fill="#fff" opacity="0.5" />
      </svg>
    ),
    livre: (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <path d="M14 14c6-4 14-4 18 0v34c-4-4-12-4-18 0V14Z" fill="#fff" opacity="0.95" />
        <path d="M50 14c-6-4-14-4-18 0v34c4-4 12-4 18 0V14Z" fill="#fff" opacity="0.75" />
        <line x1="32" y1="14" x2="32" y2="48" stroke="var(--gold)" strokeWidth="1.6" opacity="0.5" />
      </svg>
    ),
    service: (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <circle cx="24" cy="26" r="10" fill="#fff" opacity="0.95" />
        <circle cx="42" cy="30" r="8" fill="#fff" opacity="0.7" />
        <path d="M10 50c2-9 10-13 14-13s12 4 14 13" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.9" fill="none" />
        <path d="M34 50c2-7 8-10 10-10" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.6" fill="none" />
      </svg>
    ),
  };
  return scenes[kind] || scenes.cours;
}

function Logo({ size = 28 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <svg width={size} height={size} viewBox="0 0 44 44" fill="none">
        <path
          d="M9 16C9 11.0294 13.0294 7 18 7H26C30.9706 7 35 11.0294 35 16V30C35 32.7614 32.7614 35 30 35H14C11.2386 35 9 32.7614 9 30V16Z"
          fill="var(--gold)"
        />
        <path
          d="M17 7V13C17 15.7614 19.2386 18 22 18C24.7614 18 27 15.7614 27 13V7"
          stroke="var(--paper)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <rect x="14.5" y="22" width="15" height="3" rx="1.5" fill="var(--paper)" opacity="0.9" />
        <rect x="14.5" y="27.5" width="9" height="3" rx="1.5" fill="var(--paper)" opacity="0.6" />
      </svg>
      <span className="ctb-display" style={{ fontWeight: 800, fontSize: 21, color: "var(--ink)" }}>Cartable</span>
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
  const { fmt } = useCurrency();
  const typeInfo = TYPES.find((t) => t.id === course.type_annonce) || TYPES[0];
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
          {typeInfo.icon} {course.filiere} · {course.niveau}
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
        {course.type_annonce === "service" ? <span>Service</span> : <span>{course.pages} pages</span>}
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
function Home({ go, courses, openCatalog }) {
  const top = courses.slice(0, 3);
  const articles = [
    { kind: "scan", tag: "Découvrir", title: "Comment fonctionne Cartable ?", text: "Scannez, publiez, vendez : le principe en 3 étapes simples entre étudiants.", action: () => go("how") },
    { kind: "catalog", tag: "Trouver un cours", title: "Parcourir tout le catalogue", text: "Des cours vérifiés par filière, pays et université, prêts à télécharger.", action: () => openCatalog("tous") },
    { kind: "sell", tag: "Vendre", title: "Publier votre premier cours", text: "Photographiez vos pages, fixez votre prix, gardez 90% de chaque vente.", action: () => go("scan") },
  ];
  return (
    <div>
      <div style={{ background: "var(--gold)", color: "#fff", padding: "16px 6vw", position: "relative", overflow: "hidden" }}>
        <AbstractShapes />
        <span style={{ fontSize: 13.5, fontWeight: 600, position: "relative" }}>
          📣 Nouveau — les étudiants peuvent maintenant ajouter leur propre filière.{" "}
          <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => go("how")}>En savoir plus →</span>
        </span>
      </div>

      <section style={{ background: "#fff", padding: "52px 6vw 56px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 44, alignItems: "center" }} className="ctb-grid-course">
          <div className="ctb-fade-in">
            <h1 className="ctb-display ctb-hero-title" style={{ fontSize: 42, lineHeight: 1.15, margin: "0 0 18px", fontWeight: 800, color: "var(--ink)" }}>
              Vendez vos cours. Trouvez ceux qui vous manquent.
            </h1>
            <p style={{ fontSize: 16, color: "var(--ink-light)", maxWidth: 480, lineHeight: 1.6 }}>
              Cartable met en relation les étudiants qui veulent vendre leurs notes de cours
              avec ceux qui en ont besoin — partout, dans toutes les filières.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
              <button className="ctb-btn ctb-btn-primary" onClick={() => go("catalog")}>Parcourir le catalogue</button>
              <button className="ctb-btn ctb-btn-outline" onClick={() => go("scan")}>Scanner un cours</button>
            </div>
          </div>
          <div className="ctb-fade-in ctb-hide-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="ctb-card" style={{ padding: 20, gridColumn: "1 / -1" }}>
              <div className="ctb-display" style={{ fontSize: 30, fontWeight: 800, color: "var(--gold)" }}>810+</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-light)" }}>cours en vente sur la plateforme</div>
            </div>
            <div className="ctb-card" style={{ padding: 20 }}>
              <div className="ctb-display" style={{ fontSize: 24, fontWeight: 800, color: "var(--gold)" }}>90%</div>
              <div style={{ fontSize: 12, color: "var(--ink-light)" }}>reversés au vendeur</div>
            </div>
            <div className="ctb-card" style={{ padding: 20 }}>
              <div className="ctb-display" style={{ fontSize: 24, fontWeight: 800, color: "var(--gold)" }}>4.7★</div>
              <div style={{ fontSize: 12, color: "var(--ink-light)" }}>note moyenne</div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#fff", padding: "10px 6vw 52px" }}>
        <h2 className="ctb-display" style={{ fontSize: 26, fontWeight: 800, marginBottom: 20, color: "var(--ink)" }}>Explorez par catégorie</h2>
        <div className="ctb-grid-course" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
          {TYPES.map((t) => (
            <div
              key={t.id}
              className="ctb-card ctb-fade-in"
              style={{ padding: 24, cursor: "pointer", display: "flex", gap: 16, alignItems: "flex-start" }}
              onClick={() => openCatalog(t.id)}
            >
              <div style={{ width: 60, height: 60, borderRadius: 14, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Illustration kind={t.id} size={36} />
              </div>
              <div>
                <h3 className="ctb-display" style={{ fontSize: 17, fontWeight: 800, margin: "0 0 6px", color: "var(--gold)" }}>{t.label}</h3>
                <p style={{ fontSize: 13, color: "var(--ink-light)", lineHeight: 1.5, margin: 0 }}>{t.desc}</p>
                {t.id === "service" && (
                  <span
                    style={{ fontSize: 12.5, fontWeight: 700, color: "var(--gold)", textDecoration: "underline", display: "inline-block", marginTop: 8 }}
                    onClick={(e) => { e.stopPropagation(); go("publish-service"); }}
                  >
                    Proposer un service →
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "var(--paper2)", padding: "56px 6vw" }}>
        <h2 className="ctb-display" style={{ fontSize: 32, fontWeight: 800, marginBottom: 28, color: "var(--ink)" }}>Bien démarrer sur Cartable</h2>
        <div className="ctb-grid-course" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
          {articles.map((a, i) => (
            <div
              key={a.title}
              className="ctb-card ctb-fade-in"
              style={{ padding: 0, overflow: "hidden", cursor: "pointer" }}
              onClick={a.action}
            >
              <div
                style={{
                  height: 140,
                  background: [
                    "linear-gradient(135deg,#000091,#2F6FED)",
                    "linear-gradient(135deg,#1E3A8A,#5B8DEF)",
                    "linear-gradient(135deg,#0B1E52,#000091)",
                  ][i % 3],
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 48,
                }}
              >
                <Illustration kind={a.kind} size={52} />
              </div>
              <div style={{ padding: 20 }}>
                <span className="ctb-mono" style={{ fontSize: 11, color: "var(--ink-light)", fontWeight: 700, letterSpacing: "0.04em" }}>
                  {a.tag.toUpperCase()}
                </span>
                <h3 className="ctb-display" style={{ fontSize: 19, fontWeight: 800, margin: "8px 0", color: "var(--gold)" }}>{a.title}</h3>
                <p style={{ fontSize: 13.5, color: "var(--ink-light)", lineHeight: 1.5 }}>{a.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "#fff", padding: "56px 6vw 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
          <h2 className="ctb-display" style={{ fontSize: 32, fontWeight: 800, color: "var(--ink)" }}>Les mieux notés</h2>
          <span className="ctb-nav-link" onClick={() => go("catalog")}>Voir tout le catalogue →</span>
        </div>
        <div className="ctb-grid-course" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
          {top.map((c) => (
            <CourseCard key={c.id} course={c} onOpen={(course) => go("course", course)} onAdd={() => {}} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Catalog({ go, courses, cart, onAdd, filieresList, typeFilter, setTypeFilter }) {
  const [filiere, setFiliere] = useState("Toutes");
  const [q, setQ] = useState("");
  const chips = ["Toutes", ...filieresList];
  const filtered = courses.filter(
    (c) =>
      (typeFilter === "tous" || c.type_annonce === typeFilter) &&
      (filiere === "Toutes" || c.filiere === filiere) &&
      c.title.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div style={{ padding: "40px 6vw 80px" }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 32, fontWeight: 700, marginBottom: 18 }}>Catalogue</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[{ id: "tous", label: "Tout", icon: "🗂️" }, ...TYPES].map((t) => (
          <button
            key={t.id}
            onClick={() => setTypeFilter(t.id)}
            className="ctb-btn"
            style={{
              borderRadius: 10,
              padding: "10px 18px",
              fontSize: 13.5,
              border: typeFilter === t.id ? "2px solid var(--gold)" : "1.5px solid var(--line)",
              background: typeFilter === t.id ? "var(--paper2)" : "#fff",
              color: "var(--ink)",
              fontWeight: 700,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <p style={{ color: "var(--ink-light)", marginBottom: 24 }}>{filtered.length} annonce(s) disponible(s)</p>
      <div style={{ display: "flex", gap: 14, marginBottom: 26, flexWrap: "wrap" }}>
        <input
          className="ctb-input"
          style={{ maxWidth: 320 }}
          placeholder="Rechercher…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chips.map((f) => (
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
  const { fmt } = useCurrency();
  if (!course) return null;
  return (
    <div style={{ padding: "36px 6vw 80px", maxWidth: 980 }} className="ctb-fade-in">
      <span className="ctb-nav-link" onClick={() => go("catalog")}>← Retour au catalogue</span>

      <div style={{ background: "var(--paper2)", borderRadius: 14, padding: "26px 28px", marginTop: 18, marginBottom: 28 }}>
        <span className="ctb-mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700, letterSpacing: "0.05em" }}>
          FICHE FORMATION · {course.filiere.toUpperCase()}
        </span>
        <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 700, margin: "10px 0 12px" }}>{course.title}</h1>
        <div style={{ display: "flex", gap: 14, alignItems: "center", color: "var(--ink-light)", fontSize: 14, flexWrap: "wrap" }}>
          <span>Par {course.auteur}</span>
          <span>·</span>
          <StarRow note={course.note} />
          <span>·</span>
          <span>{course.ventes} ventes</span>
          <Stamp text="Certifié par les pairs" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 28 }} className="ctb-grid-course">
        <div>
          <h3 className="ctb-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Description</h3>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: "var(--ink-light)" }}>{course.blurb}</p>

          <h3 className="ctb-display" style={{ fontSize: 16, fontWeight: 700, margin: "26px 0 12px" }}>Informations pratiques</h3>
          <div className="ctb-card" style={{ padding: 0, overflow: "hidden" }}>
            {[
              ["Filière", course.filiere],
              ["Niveau", course.niveau],
              ["Format", "PDF"],
              ["Pages", course.pages],
            ].map(([label, value], i) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 18px",
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  fontSize: 13.5,
                }}
              >
                <span style={{ color: "var(--ink-light)" }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ctb-card" style={{ padding: 24, alignSelf: "start", position: "sticky", top: 96 }}>
          <div className="ctb-mono" style={{ fontSize: 11, color: "var(--ink-light)" }}>PRIX</div>
          <div className="ctb-display" style={{ fontSize: 30, fontWeight: 700, margin: "4px 0 4px" }}>{fmt(course.prix)}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-light)", marginBottom: 18 }}>Téléchargement immédiat après paiement</div>
          <button className="ctb-btn ctb-btn-primary" style={{ width: "100%" }} onClick={() => onAdd(course)}>
            {inCart ? "Déjà dans le panier ✓" : "Ajouter au panier"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanCourse({ addUploadedCourse, go, currentUser, accessToken, onRequireLogin, filieresList, addFiliere }) {
  const { fmt } = useCurrency();
  const [step, setStep] = useState("upload"); // upload -> form -> processing -> done -> error
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [scanLabelIdx, setScanLabelIdx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [typeAnnonce, setTypeAnnonce] = useState("cours");
  const [filiere, setFiliere] = useState(filieresList[0] || "Informatique");
  const [addingFiliere, setAddingFiliere] = useState(false);
  const [newFiliere, setNewFiliere] = useState("");
  const [pays, setPays] = useState("Mali");
  const [universite, setUniversite] = useState("");
  const [matiere, setMatiere] = useState("");
  const [prix, setPrix] = useState(2000);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const scanLabels = ["Lecture des pages", "Génération du PDF", "Envoi vers le stockage", "Publication du cours"];

  function confirmNewFiliere() {
    const clean = newFiliere.trim();
    if (!clean) return;
    addFiliere(clean);
    setFiliere(clean);
    setNewFiliere("");
    setAddingFiliere(false);
  }

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
      await supaCreateProfile(accessToken, {
        id: currentUser.id,
        nom_complet: currentUser.email ? currentUser.email.split("@")[0] : "Étudiant",
      });
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
        type_annonce: typeAnnonce,
        filiere,
        pays,
        universite: universite || null,
        matiere: matiere || null,
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

  const stepIndex = { upload: 0, form: 1, processing: 2, done: 3, error: 1 }[step];
  const stepLabels = ["Photos", "Détails", "Publication", "Terminé"];

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 640 }} className="ctb-fade-in">
      <span className="ctb-mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700, letterSpacing: "0.06em" }}>
        VENDRE UN COURS
      </span>
      <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 700, margin: "8px 0 22px" }}>
        Scannez votre cours en PDF
      </h1>

      <div style={{ display: "flex", gap: 6, marginBottom: 30 }}>
        {stepLabels.map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ height: 4, borderRadius: 999, background: i <= stepIndex ? "var(--gold)" : "var(--line)", marginBottom: 6 }} />
            <span className="ctb-mono" style={{ fontSize: 10.5, color: i <= stepIndex ? "var(--ink)" : "var(--ink-light)" }}>
              {i + 1}. {label}
            </span>
          </div>
        ))}
      </div>

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
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Type d'annonce</span>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ id: "cours", label: "📚 Cours" }, { id: "livre", label: "📖 Livre" }].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTypeAnnonce(t.id)}
                    className="ctb-btn"
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      padding: "10px",
                      fontSize: 13.5,
                      fontWeight: 700,
                      border: typeAnnonce === t.id ? "2px solid var(--gold)" : "1.5px solid var(--line)",
                      background: typeAnnonce === t.id ? "var(--paper2)" : "#fff",
                      color: "var(--ink)",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Titre du cours</span>
              <input className="ctb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Thermodynamique — Chapitre 2" />
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Filière</span>
              {!addingFiliere ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <select className="ctb-input" value={filiere} onChange={(e) => setFiliere(e.target.value)}>
                    {filieresList.map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <button className="ctb-btn ctb-btn-outline" style={{ whiteSpace: "nowrap", padding: "0 14px" }} onClick={() => setAddingFiliere(true)}>
                    + Ajouter
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="ctb-input"
                    placeholder="Nouvelle filière (ex : Géologie)"
                    value={newFiliere}
                    onChange={(e) => setNewFiliere(e.target.value)}
                  />
                  <button className="ctb-btn ctb-btn-primary" style={{ whiteSpace: "nowrap" }} onClick={confirmNewFiliere}>
                    Valider
                  </button>
                  <button className="ctb-btn ctb-btn-outline" onClick={() => { setAddingFiliere(false); setNewFiliere(""); }}>
                    ✕
                  </button>
                </div>
              )}
              <span style={{ fontSize: 12, color: "var(--ink-light)" }}>
                Votre filière n'existe pas encore ? Ajoutez-la — elle sera visible pour tous les étudiants.
              </span>
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Pays</span>
              <select className="ctb-input" value={pays} onChange={(e) => setPays(e.target.value)}>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Université (optionnel)</span>
              <input className="ctb-input" value={universite} onChange={(e) => setUniversite(e.target.value)} placeholder="Ex : Université des Sciences Sociales et de Gestion de Bamako" />
            </label>
            <label>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Matière précise (optionnel)</span>
              <input className="ctb-input" value={matiere} onChange={(e) => setMatiere(e.target.value)} placeholder="Ex : Droit des contrats" />
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

function PublishService({ addUploadedCourse, go, currentUser, accessToken, onRequireLogin, filieresList, addFiliere }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [filiere, setFiliere] = useState(filieresList[0] || "Informatique");
  const [pays, setPays] = useState("Mali");
  const [prix, setPrix] = useState(3000);
  const [step, setStep] = useState("form"); // form -> done -> error
  const [error, setError] = useState("");

  async function publish() {
    setError("");
    try {
      await supaCreateProfile(accessToken, {
        id: currentUser.id,
        nom_complet: currentUser.email ? currentUser.email.split("@")[0] : "Étudiant",
      });
      const created = await supaCreateCourse(accessToken, {
        vendeur_id: currentUser.id,
        titre: title || "Service sans titre",
        type_annonce: "service",
        filiere,
        pays,
        description,
        prix_fcfa: Number(prix) || 0,
        statut: "publie",
      });
      addUploadedCourse(mapDbCourseToLocal(created[0]));
      setStep("done");
    } catch (err) {
      setError(err.message);
    }
  }

  if (!currentUser) {
    return (
      <div style={{ padding: "90px 6vw", textAlign: "center" }} className="ctb-fade-in">
        <p style={{ fontWeight: 600, marginBottom: 16, fontSize: 16 }}>Connectez-vous pour proposer un service.</p>
        <button className="ctb-btn ctb-btn-primary" onClick={onRequireLogin}>Se connecter</button>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div style={{ padding: "44px 6vw 90px", maxWidth: 560 }} className="ctb-fade-in">
        <div className="ctb-card" style={{ padding: 32, textAlign: "center" }}>
          <Stamp text="Publié avec succès" />
          <h3 className="ctb-display" style={{ fontSize: 22, margin: "16px 0 8px" }}>Votre service est en ligne</h3>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
            <button className="ctb-btn ctb-btn-outline" onClick={() => { setStep("form"); setTitle(""); setDescription(""); }}>
              Proposer un autre service
            </button>
            <button className="ctb-btn ctb-btn-primary" onClick={() => go("dashboard")}>Voir mon espace</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 560 }} className="ctb-fade-in">
      <span className="ctb-mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700, letterSpacing: "0.06em" }}>
        PROPOSER UN SERVICE
      </span>
      <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 800, margin: "8px 0 22px" }}>
        Décrivez votre service
      </h1>
      <div className="ctb-card" style={{ padding: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label>
            <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Titre</span>
            <input className="ctb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Aide aux devoirs en Maths" />
          </label>
          <label>
            <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Description</span>
            <textarea className="ctb-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Expliquez en quoi consiste votre service, la durée, les modalités..." />
          </label>
          <label>
            <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Filière liée</span>
            <select className="ctb-input" value={filiere} onChange={(e) => setFiliere(e.target.value)}>
              {filieresList.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>
            <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Pays</span>
            <select className="ctb-input" value={pays} onChange={(e) => setPays(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>
            <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Prix (FCFA)</span>
            <input className="ctb-input" type="number" value={prix} onChange={(e) => setPrix(e.target.value)} />
          </label>
          {error && (
            <p style={{ color: "#fff", background: "var(--error)", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600 }}>⚠️ {error}</p>
          )}
          <button className="ctb-btn ctb-btn-primary" onClick={publish}>Publier le service</button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ uploaded, go }) {
  const { fmt } = useCurrency();
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

function MesAchats({ currentUser, accessToken, go }) {
  const { fmt } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supaListPurchases(accessToken).then((p) => {
      setPurchases(p);
      setLoading(false);
    });
  }, []);

  async function download(purchase) {
    setError("");
    setDownloading(purchase.id);
    try {
      const url = await supaGetDownloadUrl(accessToken, purchase.id);
      window.open(url, "_blank");
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 700 }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>Mes achats</h1>
      {loading ? (
        <p style={{ color: "var(--ink-light)" }}>Chargement…</p>
      ) : purchases.length === 0 ? (
        <div className="ctb-card" style={{ padding: 32, textAlign: "center", color: "var(--ink-light)" }}>
          Vous n'avez encore rien acheté. Vos cours, livres et services payés apparaîtront ici avec leur lien de téléchargement.
          <div style={{ marginTop: 16 }}>
            <button className="ctb-btn ctb-btn-primary" onClick={() => go("catalog")}>Parcourir le catalogue</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {purchases.map((p) => (
            <div key={p.id} className="ctb-card" style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.courses?.titre || "Annonce"}</div>
                <div className="ctb-mono" style={{ fontSize: 11.5, color: "var(--ink-light)" }}>{fmt(p.montant_fcfa)} · {new Date(p.cree_le).toLocaleDateString("fr-FR")}</div>
              </div>
              {p.courses?.pdf_url ? (
                <button className="ctb-btn ctb-btn-primary" style={{ fontSize: 13 }} onClick={() => download(p)} disabled={downloading === p.id}>
                  {downloading === p.id ? "Un instant…" : "⬇ Télécharger le PDF"}
                </button>
              ) : (
                <span className="ctb-mono" style={{ fontSize: 12, color: "var(--ink-light)" }}>Service — contactez le vendeur</span>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p style={{ color: "#fff", background: "var(--error)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 16, fontWeight: 600 }}>⚠️ {error}</p>
      )}
    </div>
  );
}

function Cart({ cart, onRemove, go, onCheckout }) {
  const { fmt } = useCurrency();
  const realItems = cart.filter((c) => c.isReal);
  const demoItems = cart.filter((c) => !c.isReal);
  const total = realItems.reduce((s, c) => s + c.prix, 0);
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
          {demoItems.length > 0 && (
            <p style={{ fontSize: 12.5, color: "var(--ink-light)", background: "var(--paper2)", padding: "10px 14px", borderRadius: 10, marginBottom: 16 }}>
              ℹ️ {demoItems.length} article(s) de démonstration dans votre panier ne peuvent pas être achetés (ce sont des exemples, pas de vrais cours publiés) — ils ne seront pas comptés au paiement.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {cart.map((c) => (
              <div key={c.id} className="ctb-card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: c.isReal ? 1 : 0.6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.title} {!c.isReal && <span className="ctb-mono" style={{ fontSize: 10.5 }}>(exemple)</span>}</div>
                  <div className="ctb-mono" style={{ fontSize: 11.5, color: "var(--ink-light)" }}>{c.filiere}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span className="ctb-mono" style={{ fontWeight: 700 }}>{fmt(c.prix)}</span>
                  <span style={{ cursor: "pointer", color: "var(--error)", fontSize: 13 }} onClick={() => onRemove(c.id)}>Retirer</span>
                </div>
              </div>
            ))}
          </div>
          <div className="ctb-card" style={{ padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="ctb-display" style={{ fontSize: 20, fontWeight: 700 }}>Total : {fmt(total)}</span>
            <button className="ctb-btn ctb-btn-primary" onClick={() => onCheckout(realItems)} disabled={realItems.length === 0}>
              Passer au paiement
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Checkout({ items, currentUser, accessToken, go, onPaid }) {
  const { fmt, code, rate } = useCurrency();
  const cart = items || [];
  const total = cart.reduce((s, c) => s + c.prix, 0);
  const [phase, setPhase] = useState("select"); // select -> paying -> error
  const [error, setError] = useState("");

  async function pay() {
    setError("");
    setPhase("paying");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          buyer_id: currentUser.id,
          currency: code,
          rate,
          items: cart.map((c) => ({ course_id: c.id, vendeur_id: c.vendeur_id, prix_fcfa: c.prix, title: c.title })),
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Impossible de créer le paiement.");
      }
    } catch (err) {
      setError(err.message);
      setPhase("select");
    }
  }

  if (cart.length === 0) {
    return (
      <div style={{ padding: "90px 6vw", textAlign: "center" }} className="ctb-fade-in">
        <p style={{ color: "var(--ink-light)" }}>Aucun article à payer.</p>
        <button className="ctb-btn ctb-btn-primary" style={{ marginTop: 16 }} onClick={() => go("catalog")}>Retour au catalogue</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 560 }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 28, fontWeight: 700, marginBottom: 22 }}>Paiement</h1>

      {phase === "select" && (
        <>
          <div className="ctb-card" style={{ padding: 20, marginBottom: 20 }}>
            <span className="ctb-mono" style={{ fontSize: 11, color: "var(--ink-light)" }}>MONTANT À PAYER</span>
            <div className="ctb-display" style={{ fontSize: 28, fontWeight: 700 }}>{fmt(total)}</div>
            <p style={{ fontSize: 12.5, color: "var(--ink-light)", marginTop: 6 }}>
              {cart.length} article(s) · paiement sécurisé par carte bancaire sur la page suivante
            </p>
          </div>
          {error && (
            <p style={{ color: "#fff", background: "var(--error)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
              ⚠️ {error}
            </p>
          )}
          <button className="ctb-btn ctb-btn-primary" style={{ width: "100%", padding: "14px" }} onClick={pay}>
            Payer {fmt(total)}
          </button>
        </>
      )}

      {phase === "paying" && (
        <div className="ctb-card" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ fontWeight: 600 }}>Redirection vers la page de paiement sécurisée…</p>
          <div className="ctb-progress-track" style={{ marginTop: 18 }}>
            <div className="ctb-progress-fill" style={{ width: "100%", transition: "width 1.2s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ConsentBanner({ onAccept, go }) {
  const [checked, setChecked] = useState(false);
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 100, background: "var(--ink)", color: "#fff", padding: "18px 6vw", boxShadow: "0 -4px 20px rgba(0,0,0,0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 620 }}>
          <p style={{ fontWeight: 700, marginBottom: 6, fontSize: 14.5 }}>🔒 Avant de continuer</p>
          <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5, marginBottom: 10 }}>
            Cartable utilise des cookies nécessaires au fonctionnement du site (connexion, panier) et vous demande de confirmer que vous avez pris connaissance de nos règles d'utilisation avant de continuer.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", flexWrap: "wrap" }}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            J'ai lu et j'accepte les{" "}
            <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => go("cgu")}>conditions d'utilisation</span>
            {" "}et la{" "}
            <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => go("confidentialite")}>politique de confidentialité</span>
          </label>
        </div>
        <button
          className="ctb-btn ctb-btn-gold"
          disabled={!checked}
          style={{ opacity: checked ? 1 : 0.5, cursor: checked ? "pointer" : "not-allowed" }}
          onClick={onAccept}
        >
          Continuer
        </button>
      </div>
    </div>
  );
}

function LegalPage({ title, updated, sections, go }) {
  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 760 }} className="ctb-fade-in">
      <span className="ctb-nav-link" onClick={() => go("home")}>← Retour à l'accueil</span>
      <h1 className="ctb-display" style={{ fontSize: 30, fontWeight: 800, margin: "16px 0 6px" }}>{title}</h1>
      <p style={{ fontSize: 13, color: "var(--ink-light)", marginBottom: 30 }}>Dernière mise à jour : {updated}</p>
      {sections.map(([h, body]) => (
        <div key={h} style={{ marginBottom: 26 }}>
          <h3 className="ctb-display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: "var(--gold)" }}>{h}</h3>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--ink-light)", whiteSpace: "pre-line" }}>{body}</p>
        </div>
      ))}
    </div>
  );
}

function MentionsLegales({ go }) {
  return (
    <LegalPage
      go={go}
      title="Mentions légales"
      updated="août 2026"
      sections={[
        ["Éditeur du site", "Cartable est édité à titre individuel par Abdoulaye Siby, étudiant, joignable à l'adresse indiquée sur la page de contact. Cartable n'est pas, à ce stade, une société immatriculée."],
        ["Hébergement", "Le site est hébergé par Vercel Inc., et la base de données par Supabase Inc. Ces prestataires peuvent traiter des données techniques de connexion conformément à leurs propres politiques."],
        ["Propriété intellectuelle", "La marque « Cartable », le logo et le design du site sont la propriété de l'éditeur. Les cours, livres et descriptions de services publiés par les utilisateurs restent la propriété de leurs auteurs respectifs ; leur mise en vente sur la plateforme n'emporte aucun transfert de propriété intellectuelle à Cartable."],
        ["Contact", "Pour toute question relative au site, vous pouvez nous contacter via l'adresse e-mail de support indiquée dans votre espace profil."],
      ]}
    />
  );
}

function CGU({ go }) {
  return (
    <LegalPage
      go={go}
      title="Conditions Générales d'Utilisation"
      updated="août 2026"
      sections={[
        ["1. Objet", "Les présentes conditions régissent l'utilisation de Cartable, plateforme permettant à des étudiants de vendre et d'acheter des cours, des livres et des services entre eux."],
        ["2. Inscription", "L'inscription est ouverte à toute personne disposant d'une adresse e-mail valide. L'utilisateur s'engage à fournir des informations exactes et à conserver la confidentialité de son mot de passe."],
        ["3. Contenu déposé par les vendeurs", "Chaque vendeur est seul responsable du contenu qu'il publie (cours, livres, description de service) et garantit disposer des droits nécessaires pour le proposer à la vente. Cartable se réserve le droit de retirer tout contenu signalé comme illicite ou contrefaisant."],
        ["4. Commission et paiement", "Cartable prélève une commission de 10% sur chaque vente réalisée sur la plateforme. Le vendeur perçoit les 90% restants selon le ou les moyens de paiement qu'il a renseignés dans son profil."],
        ["5. Responsabilité", "Cartable agit en tant qu'intermédiaire technique entre acheteurs et vendeurs et ne garantit pas la qualité pédagogique du contenu vendu. Tout litige relatif au contenu d'un cours doit d'abord être traité entre l'acheteur et le vendeur."],
        ["6. Résiliation", "Tout utilisateur peut cesser d'utiliser la plateforme à tout moment. Cartable se réserve le droit de suspendre un compte en cas de non-respect des présentes conditions."],
        ["7. Droit applicable", "Les présentes conditions sont, à titre indicatif, soumises au droit malien. En cas d'usage international, le droit applicable pourra être précisé ultérieurement."],
      ]}
    />
  );
}

function Confidentialite({ go }) {
  return (
    <LegalPage
      go={go}
      title="Politique de confidentialité"
      updated="août 2026"
      sections={[
        ["Données collectées", "Cartable collecte votre adresse e-mail, votre nom, et, si vous le renseignez, votre pays, votre université et vos numéros de moyens de paiement (Orange Money, Moov Money, Wave, coordonnées bancaires) pour vous permettre de recevoir vos ventes."],
        ["Utilisation des données", "Ces données sont utilisées uniquement pour faire fonctionner votre compte, afficher vos annonces, et vous reverser le produit de vos ventes. Elles ne sont ni vendues ni partagées à des fins publicitaires."],
        ["Conservation", "Vos données sont conservées tant que votre compte est actif. Vous pouvez demander leur suppression à tout moment en nous contactant."],
        ["Vos droits", "Conformément aux principes de protection des données, vous disposez d'un droit d'accès, de rectification et de suppression de vos données personnelles."],
        ["Cookies", "Cartable utilise uniquement des cookies techniques nécessaires au fonctionnement du site (maintien de la connexion, panier). Aucun cookie publicitaire ou de traçage tiers n'est utilisé à ce stade."],
      ]}
    />
  );
}

function HowItWorks({ go }) {
  return (
    <div style={{ padding: "48px 6vw 90px", maxWidth: 780 }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 32, fontWeight: 800, marginBottom: 10 }}>Comment fonctionne Cartable ?</h1>
      <p style={{ color: "var(--ink-light)", fontSize: 15.5, lineHeight: 1.7, marginBottom: 30 }}>
        Cartable est une plateforme où les étudiants vendent et achètent des cours, des livres
        et des services entre eux, en toute simplicité.
      </p>
      {[
        ["1. Scannez ou publiez", "Photographiez les pages d'un cours ou d'un livre pour en faire un PDF, ou décrivez un service que vous proposez (aide aux devoirs, relecture, tutorat...)."],
        ["2. Fixez votre prix", "Vous choisissez librement le prix de vente. Cartable prélève une commission de 10% ; vous gardez 90%."],
        ["3. Recevez vos paiements", "Choisissez dans votre profil comment être payé : Orange Money, Moov Money, Wave ou virement bancaire."],
        ["4. Les autres étudiants achètent", "Vos annonces apparaissent dans le catalogue, classées par filière, pays et catégorie (cours, livre ou service)."],
      ].map(([title, text]) => (
        <div key={title} className="ctb-card" style={{ padding: 22, marginBottom: 14 }}>
          <h3 className="ctb-display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: "var(--gold)" }}>{title}</h3>
          <p style={{ fontSize: 14, color: "var(--ink-light)", lineHeight: 1.6 }}>{text}</p>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
        <button className="ctb-btn ctb-btn-primary" onClick={() => go("scan")}>Publier un cours ou un livre</button>
        <button className="ctb-btn ctb-btn-outline" onClick={() => go("catalog")}>Parcourir le catalogue</button>
      </div>
    </div>
  );
}

function ProfilePage({ currentUser, accessToken, go }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [nom, setNom] = useState("");
  const [methods, setMethods] = useState([]);
  const [numeros, setNumeros] = useState({ orange: "", moov: "", wave: "", banque: "" });

  const PAYOUT_METHODS = [
    { id: "orange", label: "Orange Money", placeholder: "Numéro Orange Money" },
    { id: "moov", label: "Moov Money", placeholder: "Numéro Moov Money" },
    { id: "wave", label: "Wave", placeholder: "Numéro Wave" },
    { id: "banque", label: "Virement bancaire", placeholder: "IBAN / numéro de compte" },
  ];

  useEffect(() => {
    supaGetProfile(accessToken, currentUser.id).then((p) => {
      if (p) {
        setNom(p.nom_complet || "");
        setMethods(p.payout_methods || []);
        setNumeros({
          orange: p.payout_orange || "",
          moov: p.payout_moov || "",
          wave: p.payout_wave || "",
          banque: p.payout_banque || "",
        });
      }
      setLoading(false);
    });
  }, []);

  function toggleMethod(id) {
    setMethods((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await supaUpdateProfile(accessToken, currentUser.id, {
        nom_complet: nom,
        payout_methods: methods,
        payout_orange: numeros.orange || null,
        payout_moov: numeros.moov || null,
        payout_wave: numeros.wave || null,
        payout_banque: numeros.banque || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ padding: "90px 6vw", textAlign: "center", color: "var(--ink-light)" }}>Chargement de votre profil…</div>;
  }

  return (
    <div style={{ padding: "44px 6vw 90px", maxWidth: 640 }} className="ctb-fade-in">
      <h1 className="ctb-display" style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Mon profil</h1>
      <p style={{ color: "var(--ink-light)", marginBottom: 28 }}>{currentUser.email}</p>

      <div className="ctb-card" style={{ padding: 24, marginBottom: 22 }}>
        <h3 className="ctb-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Informations</h3>
        <label>
          <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Nom complet</span>
          <input className="ctb-input" value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>
      </div>

      <div className="ctb-card" style={{ padding: 24, marginBottom: 22 }}>
        <h3 className="ctb-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Comment recevoir vos paiements</h3>
        <p style={{ fontSize: 13, color: "var(--ink-light)", marginBottom: 16 }}>
          Choisissez un ou plusieurs moyens pour être payé quand un étudiant achète un de vos cours.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {PAYOUT_METHODS.map((m) => (
            <div key={m.id}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={methods.includes(m.id)} onChange={() => toggleMethod(m.id)} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{m.label}</span>
              </label>
              {methods.includes(m.id) && (
                <input
                  className="ctb-input"
                  style={{ marginTop: 8 }}
                  placeholder={m.placeholder}
                  value={numeros[m.id]}
                  onChange={(e) => setNumeros((n) => ({ ...n, [m.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p style={{ color: "#fff", background: "var(--error)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
          ⚠️ {error}
        </p>
      )}
      {saved && (
        <p style={{ color: "#fff", background: "var(--green)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
          ✓ Profil enregistré
        </p>
      )}
      <button className="ctb-btn ctb-btn-primary" onClick={save} disabled={saving}>
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
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
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [catalogTypeFilter, setCatalogTypeFilter] = useState("tous");
  const [checkoutItems, setCheckoutItems] = useState([]);
  const currency = useCurrencyDetection();
  const [consentGiven, setConsentGiven] = useState(false);

  function openCatalog(type) {
    setCatalogTypeFilter(type);
    go("catalog");
  }
  const [filieresList, setFilieresList] = useState(FILIERES.filter((f) => f !== "Toutes"));
  const allCourses = [...SEED_COURSES, ...uploaded];

  useEffect(() => {
    supaListFilieres().then((remote) => {
      if (remote.length === 0) return;
      setFilieresList((current) => {
        const merged = Array.from(new Set([...current, ...remote]));
        merged.sort((a, b) => a.localeCompare(b, "fr"));
        return merged;
      });
    });
  }, []);

  async function addFiliere(nom) {
    const clean = nom.trim();
    if (!clean) return;
    if (accessToken) {
      try {
        await supaAddFiliere(accessToken, clean);
      } catch (err) {
        // si elle existe déjà ou si l'ajout échoue, on l'affiche quand même localement
      }
    }
    setFilieresList((current) =>
      current.includes(clean) ? current : [...current, clean].sort((a, b) => a.localeCompare(b, "fr"))
    );
  }

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
    <CurrencyContext.Provider value={currency}>
    <div className="ctb-root">
      <style>{FONTS}</style>

      <div style={{ background: "var(--ink)", color: "#fff", fontSize: 12, textAlign: "center", padding: "6px 12px" }} className="ctb-mono">
        Plateforme officielle des étudiants pour les étudiants
      </div>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: "3px solid var(--gold)", boxShadow: "0 1px 3px rgba(15,23,42,0.06)" }}>
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
                <span className="ctb-mono" style={{ marginLeft: 6, background: "var(--error)", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11 }}>
                  {cart.length}
                </span>
              )}
            </button>
            {currentUser ? (
              <div style={{ position: "relative" }}>
                <button
                  className="ctb-btn ctb-btn-outline"
                  style={{ padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                  onClick={() => setShowProfileMenu((s) => !s)}
                >
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--gold)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                    {currentUser.email?.[0]?.toUpperCase()}
                  </span>
                  <span className="ctb-hide-mobile">{currentUser.email}</span>
                  <span>▾</span>
                </button>
                {showProfileMenu && (
                  <div
                    className="ctb-card"
                    style={{ position: "absolute", right: 0, top: "110%", width: 200, padding: 8, zIndex: 30 }}
                  >
                    <div
                      style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}
                      onClick={() => { setShowProfileMenu(false); go("profile"); }}
                    >
                      👤 Mon profil
                    </div>
                    <div
                      style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}
                      onClick={() => { setShowProfileMenu(false); go("dashboard"); }}
                    >
                      📊 Mon espace vendeur
                    </div>
                    <div
                      style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}
                      onClick={() => { setShowProfileMenu(false); go("achats"); }}
                    >
                      🧾 Mes achats
                    </div>
                    <div style={{ height: 1, background: "var(--line)", margin: "6px 0" }} />
                    <div
                      style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: "var(--error)" }}
                      onClick={() => { setShowProfileMenu(false); handleSignOut(); }}
                    >
                      Déconnexion
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button className="ctb-btn ctb-btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setShowAuthModal(true)}>
                Connexion
              </button>
            )}
            <button
              className="ctb-mobile-menu-btn ctb-btn ctb-btn-outline"
              style={{ padding: "8px 12px", fontSize: 16, alignItems: "center", justifyContent: "center" }}
              onClick={() => setShowMobileNav((s) => !s)}
              aria-label="Menu"
            >
              {showMobileNav ? "✕" : "☰"}
            </button>
          </div>
        </div>
        <div className={"ctb-mobile-panel" + (showMobileNav ? " open" : "")} style={{ flexDirection: "column", borderTop: "1px solid var(--line)", padding: "8px 6vw 14px" }}>
          {navItems.map(([id, label]) => (
            <span
              key={id}
              className="ctb-nav-link"
              style={{ padding: "12px 4px", borderBottom: "1px solid var(--line)" }}
              onClick={() => { setShowMobileNav(false); go(id); }}
            >
              {label}
            </span>
          ))}
        </div>
      </header>

      <main>
        {view === "home" && <Home go={go} courses={allCourses} openCatalog={openCatalog} />}
        {view === "how" && <HowItWorks go={go} />}
        {view === "mentions" && <MentionsLegales go={go} />}
        {view === "cgu" && <CGU go={go} />}
        {view === "confidentialite" && <Confidentialite go={go} />}
        {view === "catalog" && (
          <Catalog
            go={go}
            courses={allCourses}
            cart={cart}
            onAdd={addToCart}
            filieresList={filieresList}
            typeFilter={catalogTypeFilter}
            setTypeFilter={setCatalogTypeFilter}
          />
        )}
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
            filieresList={filieresList}
            addFiliere={addFiliere}
          />
        )}
        {view === "publish-service" && (
          <PublishService
            addUploadedCourse={addUploadedCourse}
            go={go}
            currentUser={currentUser}
            accessToken={accessToken}
            onRequireLogin={() => setShowAuthModal(true)}
            filieresList={filieresList}
            addFiliere={addFiliere}
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
        {view === "profile" &&
          (currentUser ? (
            <ProfilePage currentUser={currentUser} accessToken={accessToken} go={go} />
          ) : (
            <div style={{ padding: "90px 6vw", textAlign: "center" }} className="ctb-fade-in">
              <p style={{ fontWeight: 600, marginBottom: 16, fontSize: 16 }}>Connectez-vous pour voir votre profil.</p>
              <button className="ctb-btn ctb-btn-primary" onClick={() => setShowAuthModal(true)}>Se connecter</button>
            </div>
          ))}
        {view === "cart" && <Cart cart={cart} onRemove={removeFromCart} go={go} onCheckout={(items) => { setCheckoutItems(items); go("checkout"); }} />}
        {view === "checkout" && <Checkout items={checkoutItems} currentUser={currentUser} accessToken={accessToken} go={go} onPaid={() => setCart([])} />}
        {view === "achats" &&
          (currentUser ? (
            <MesAchats currentUser={currentUser} accessToken={accessToken} go={go} />
          ) : (
            <div style={{ padding: "90px 6vw", textAlign: "center" }} className="ctb-fade-in">
              <p style={{ fontWeight: 600, marginBottom: 16, fontSize: 16 }}>Connectez-vous pour voir vos achats.</p>
              <button className="ctb-btn ctb-btn-primary" onClick={() => setShowAuthModal(true)}>Se connecter</button>
            </div>
          ))}
      </main>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onAuthed={handleAuthed} />}
      {!consentGiven && <ConsentBanner onAccept={() => setConsentGiven(true)} go={go} />}

      <footer style={{ borderTop: "1px solid var(--line)", padding: "36px 6vw", marginTop: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 24 }}>
          <div>
            <Logo size={18} />
            <span style={{ fontSize: 12.5, color: "var(--ink-light)", display: "block", marginTop: 10 }}>
              © 2026 Cartable — Le marché des cours entre étudiants.
            </span>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <span className="ctb-nav-link" style={{ fontSize: 12.5 }} onClick={() => go("mentions")}>Mentions légales</span>
            <span className="ctb-nav-link" style={{ fontSize: 12.5 }} onClick={() => go("cgu")}>CGU</span>
            <span className="ctb-nav-link" style={{ fontSize: 12.5 }} onClick={() => go("confidentialite")}>Confidentialité</span>
            <span className="ctb-nav-link" style={{ fontSize: 12.5 }} onClick={() => go("how")}>Comment ça marche</span>
          </div>
        </div>
      </footer>
    </div>
    </CurrencyContext.Provider>
  );
}
