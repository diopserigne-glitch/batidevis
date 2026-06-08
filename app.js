/* =====================================================================
   BâtiDevis — Estimateur de matériaux & coûts de construction (Sénégal)
   Moteur de calcul + interface. Aucune dépendance externe.
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   1. PRIX DU MARCHÉ (valeurs indicatives Dakar 2026, en FCFA)
   Modifiables par l'utilisateur, persistés dans localStorage.
   --------------------------------------------------------------------- */
const PRIX_DEFAUT = {
  ciment:   { label: 'Ciment (sac de 50 kg)', unite: 'sac', valeur: 4200 },
  fer:      { label: 'Fer à béton (acier)',   unite: 'kg',  valeur: 700  },
  sable:    { label: 'Sable',                 unite: 'm³',  valeur: 8000 },
  gravier:  { label: 'Gravier',               unite: 'm³',  valeur: 16000 },
  agglo15:  { label: 'Agglo 15 (parpaing)',   unite: 'u',   valeur: 175  },
  agglo20:  { label: 'Agglo 20 (parpaing)',   unite: 'u',   valeur: 225  },
  entrevous:{ label: 'Entrevous (hourdis 16)', unite: 'u',  valeur: 350  },
};

const ICONES = {
  ciment: '🪣', fer: '🔩', sable: '⏳', gravier: '🪨', agglo15: '🧱', agglo20: '🧱', entrevous: '🟫',
};

/* Annuaire fournisseurs — données d'exemple à compléter / brancher sur un backend.
   `mat` utilise des familles : ciment, fer, sable, gravier, agglos. */
const FOURNISSEURS = [
  { nom: 'Quincaillerie Touba Darou', zone: 'Dakar — Pikine', tel: '221770000001',
    mat: ['ciment', 'fer', 'agglos'] },
  { nom: 'Dépôt Sandaga Matériaux', zone: 'Dakar — Plateau', tel: '221770000002',
    mat: ['ciment', 'sable', 'gravier'] },
  { nom: 'Ets Ndiaye & Frères', zone: 'Thiès', tel: '221770000003',
    mat: ['ciment', 'fer', 'agglos', 'sable'] },
  { nom: 'Comptoir BTP Mbour', zone: 'Mbour', tel: '221770000004',
    mat: ['sable', 'gravier', 'agglos'] },
  { nom: 'Sococim Distribution', zone: 'Rufisque', tel: '221770000005',
    mat: ['ciment'] },
  { nom: 'Fer & Acier Sénégal', zone: 'Dakar — Colobane', tel: '221770000006',
    mat: ['fer'] },
];
const LABEL_MAT = { ciment: 'Ciment', fer: 'Fer', sable: 'Sable', gravier: 'Gravier', agglos: 'Agglos' };

let prix = chargerPrix();

function chargerPrix() {
  try {
    const sauve = JSON.parse(localStorage.getItem('batidevis_prix'));
    const base = structuredClone(PRIX_DEFAUT);
    if (sauve) {
      for (const k in base) if (typeof sauve[k] === 'number') base[k].valeur = sauve[k];
    }
    return base;
  } catch {
    return structuredClone(PRIX_DEFAUT);
  }
}

function sauverPrix() {
  const plat = {};
  for (const k in prix) plat[k] = prix[k].valeur;
  localStorage.setItem('batidevis_prix', JSON.stringify(plat));
}

/* ---------------------------------------------------------------------
   2. CONSTANTES TECHNIQUES (pratiques courantes BTP)
   --------------------------------------------------------------------- */
const SAC_KG = 50;             // 1 sac de ciment = 50 kg
const SABLE_PAR_M3 = 0.40;     // m³ de sable par m³ de béton
const GRAVIER_PAR_M3 = 0.80;   // m³ de gravier par m³ de béton
const AGGLOS_PAR_M2 = 12.5;    // agglos 20x40 (face) par m² de mur
const MORTIER_PAR_M2 = 0.020;  // m³ de mortier de pose par m² de mur
const DOSAGE_MORTIER = 300;    // kg de ciment / m³ de mortier
const SABLE_MORTIER_PAR_M3 = 1.05; // m³ de sable par m³ de mortier

/* Helper : à partir d'un volume de béton (m³) et d'un dosage (kg/m³),
   renvoie les quantités de ciment, sable, gravier. */
function beton(volume, dosage) {
  const cimentKg = volume * dosage;
  return {
    cimentSacs: cimentKg / SAC_KG,
    sable: volume * SABLE_PAR_M3,
    gravier: volume * GRAVIER_PAR_M3,
  };
}

/* --- Métré du fer par diamètre (acier HA) --- */
const FER_MASSE = { HA6: 0.222, HA8: 0.395, HA10: 0.617, HA12: 0.888, HA14: 1.208 }; // kg par mètre linéaire
const LONGUEUR_BARRE = 12; // longueur standard d'une barre (m)
const ORDRE_FER = ['HA6', 'HA8', 'HA10', 'HA12', 'HA14'];

// Répartition typique du ferraillage par type d'ouvrage (% du poids total)
const FER_DISTRIB = {
  dalle:   { HA8: 0.70, HA10: 0.30 },
  hourdis: { HA6: 0.40, HA8: 0.40, HA10: 0.20 },
  poteau:  { HA12: 0.65, HA8: 0.35 },
  poutre:  { HA12: 0.70, HA8: 0.30 },
  semelle: { HA10: 0.60, HA8: 0.40 },
};

// Répartit un poids total de fer (kg) selon le type d'ouvrage -> { HA8: kg, ... }
function repartirFer(type, kg) {
  if (!kg || kg <= 0) return {};
  const d = FER_DISTRIB[type] || { HA8: 1 };
  const out = {};
  for (const diam in d) out[diam] = kg * d[diam];
  return out;
}

/* ---------------------------------------------------------------------
   3. DÉFINITION DES ÉLÉMENTS (champs + calcul)
   Chaque calcul renvoie : { volume?, surface?, materiaux:{}, details:[] }
   materiaux : { ciment(sacs), fer(kg), sable(m³), gravier(m³), agglo15(u), agglo20(u) }
   --------------------------------------------------------------------- */
const ELEMENTS = {

  dalle: {
    nom: 'Dalle pleine',
    champs: [
      { id: 'longueur', label: 'Longueur', unite: 'm', def: 5 },
      { id: 'largeur',  label: 'Largeur',  unite: 'm', def: 4 },
      { id: 'epaisseur', label: 'Épaisseur', unite: 'cm', def: 15 },
    ],
    avances: [
      { id: 'dosage', label: 'Dosage béton', unite: 'kg/m³', def: 350 },
      { id: 'ferRatio', label: 'Ferraillage', unite: 'kg/m³', def: 85 },
    ],
    calcul(v) {
      const volume = v.longueur * v.largeur * (v.epaisseur / 100);
      const b = beton(volume, v.dosage);
      return {
        volume,
        materiaux: {
          ciment: b.cimentSacs, sable: b.sable, gravier: b.gravier,
          fer: volume * v.ferRatio,
        },
        details: [
          `Surface : ${fmt(v.longueur * v.largeur, 2)} m²`,
          `Volume de béton : ${fmt(volume, 3)} m³ (dosé à ${v.dosage} kg/m³)`,
        ],
      };
    },
  },

  hourdis: {
    nom: 'Plancher à hourdis',
    champs: [
      { id: 'longueur', label: 'Longueur', unite: 'm', def: 5 },
      { id: 'largeur',  label: 'Largeur',  unite: 'm', def: 4 },
    ],
    avances: [
      { id: 'entrevousM2', label: 'Entrevous', unite: 'u/m²', def: 8 },
      { id: 'betonM2', label: 'Béton (table + nervures)', unite: 'm³/m²', def: 0.06 },
      { id: 'dosage', label: 'Dosage béton', unite: 'kg/m³', def: 350 },
      { id: 'ferM2', label: 'Ferraillage', unite: 'kg/m²', def: 5 },
    ],
    calcul(v) {
      const surface = v.longueur * v.largeur;
      const volume = surface * v.betonM2;
      const b = beton(volume, v.dosage);
      return {
        surface,
        materiaux: {
          ciment: b.cimentSacs, sable: b.sable, gravier: b.gravier,
          fer: surface * v.ferM2,
          entrevous: surface * v.entrevousM2,
        },
        details: [
          `Plancher corps creux : ${fmt(surface, 2)} m²`,
          `≈ ${Math.ceil(surface * v.entrevousM2)} entrevous &middot; ${fmt(volume, 3)} m³ de béton (table de compression)`,
        ],
      };
    },
  },

  mur: {
    nom: 'Mur en agglos',
    champs: [
      { id: 'longueur', label: 'Longueur', unite: 'm', def: 10 },
      { id: 'hauteur',  label: 'Hauteur',  unite: 'm', def: 3 },
      { id: 'ouvertures', label: 'Ouvertures (portes/fenêtres)', unite: 'm²', def: 0, full: true },
    ],
    avances: [
      { id: 'typeAgglo', label: "Type d'agglo", unite: '', def: 15, choix: [
        { v: 15, t: 'Agglo 15' }, { v: 20, t: 'Agglo 20' },
      ] },
    ],
    calcul(v) {
      const surface = Math.max(0, v.longueur * v.hauteur - v.ouvertures);
      const nbAgglos = surface * AGGLOS_PAR_M2;
      const volMortier = surface * MORTIER_PAR_M2;
      const cimentKg = volMortier * DOSAGE_MORTIER;
      const mat = {
        ciment: cimentKg / SAC_KG,
        sable: volMortier * SABLE_MORTIER_PAR_M3,
      };
      if (v.typeAgglo === 20) mat.agglo20 = nbAgglos; else mat.agglo15 = nbAgglos;
      return {
        surface,
        materiaux: mat,
        details: [
          `Surface de mur : ${fmt(surface, 2)} m²`,
          `≈ ${Math.ceil(nbAgglos)} agglos de ${v.typeAgglo} (mortier de pose inclus)`,
        ],
      };
    },
  },

  poteau: {
    nom: 'Poteau',
    champs: [
      { id: 'cote_a', label: 'Côté A', unite: 'cm', def: 20 },
      { id: 'cote_b', label: 'Côté B', unite: 'cm', def: 20 },
      { id: 'hauteur', label: 'Hauteur', unite: 'm', def: 3 },
      { id: 'nombre', label: 'Nombre', unite: 'u', def: 1 },
    ],
    avances: [
      { id: 'dosage', label: 'Dosage béton', unite: 'kg/m³', def: 350 },
      { id: 'ferRatio', label: 'Ferraillage', unite: 'kg/m³', def: 120 },
    ],
    calcul(v) {
      const volUnit = (v.cote_a / 100) * (v.cote_b / 100) * v.hauteur;
      const volume = volUnit * v.nombre;
      const b = beton(volume, v.dosage);
      return {
        volume,
        materiaux: {
          ciment: b.cimentSacs, sable: b.sable, gravier: b.gravier,
          fer: volume * v.ferRatio,
        },
        details: [
          `${v.nombre} poteau(x) de ${v.cote_a}×${v.cote_b} cm, h = ${v.hauteur} m`,
          `Volume de béton : ${fmt(volume, 3)} m³ (dosé à ${v.dosage} kg/m³)`,
        ],
      };
    },
  },

  poutre: {
    nom: 'Poutre / chaînage',
    champs: [
      { id: 'largeur', label: 'Largeur', unite: 'cm', def: 20 },
      { id: 'hauteur', label: 'Hauteur', unite: 'cm', def: 20 },
      { id: 'longueur', label: 'Longueur', unite: 'm', def: 4 },
      { id: 'nombre', label: 'Nombre', unite: 'u', def: 1 },
    ],
    avances: [
      { id: 'dosage', label: 'Dosage béton', unite: 'kg/m³', def: 350 },
      { id: 'ferRatio', label: 'Ferraillage', unite: 'kg/m³', def: 130 },
    ],
    calcul(v) {
      const volUnit = (v.largeur / 100) * (v.hauteur / 100) * v.longueur;
      const volume = volUnit * v.nombre;
      const b = beton(volume, v.dosage);
      return {
        volume,
        materiaux: {
          ciment: b.cimentSacs, sable: b.sable, gravier: b.gravier,
          fer: volume * v.ferRatio,
        },
        details: [
          `${v.nombre} poutre(s) de ${v.largeur}×${v.hauteur} cm, L = ${v.longueur} m`,
          `Volume de béton : ${fmt(volume, 3)} m³ (dosé à ${v.dosage} kg/m³)`,
        ],
      };
    },
  },

  semelle: {
    nom: 'Semelle de fondation',
    champs: [
      { id: 'longueur', label: 'Longueur totale', unite: 'm', def: 30 },
      { id: 'largeur', label: 'Largeur', unite: 'cm', def: 60 },
      { id: 'epaisseur', label: 'Épaisseur', unite: 'cm', def: 25 },
    ],
    avances: [
      { id: 'dosage', label: 'Dosage béton', unite: 'kg/m³', def: 350 },
      { id: 'ferRatio', label: 'Ferraillage', unite: 'kg/m³', def: 70 },
    ],
    calcul(v) {
      const volume = v.longueur * (v.largeur / 100) * (v.epaisseur / 100);
      const b = beton(volume, v.dosage);
      return {
        volume,
        materiaux: {
          ciment: b.cimentSacs, sable: b.sable, gravier: b.gravier,
          fer: volume * v.ferRatio,
        },
        details: [
          `Semelle filante : ${v.longueur} m × ${v.largeur} cm × ${v.epaisseur} cm`,
          `Volume de béton : ${fmt(volume, 3)} m³ (dosé à ${v.dosage} kg/m³)`,
        ],
      };
    },
  },

  villa: {
    nom: 'Villa (bâtiment complet)',
    champs: [
      { id: 'emprise', label: 'Surface au sol (emprise)', unite: 'm²', def: 100 },
      { id: 'hauteur', label: 'Hauteur sous plafond', unite: 'm', def: 3 },
    ],
    avances: [
      { id: 'niveaux', label: 'Niveaux', unite: '', def: 2, choix: [
        { v: 1, t: 'R (plain-pied)' }, { v: 2, t: 'R+1' }, { v: 3, t: 'R+2' },
      ] },
      { id: 'typePlancher', label: 'Type de plancher', unite: '', def: 'hourdis', choix: [
        { v: 'hourdis', t: 'Hourdis (corps creux)' }, { v: 'dalle', t: 'Dalle pleine' },
      ] },
      { id: 'tauxOuverture', label: 'Ouvertures (portes/fenêtres)', unite: '%', def: 18 },
    ],
    calcul(v) {
      const niveaux = v.niveaux;
      const cote = Math.sqrt(v.emprise);
      const perim = 4 * cote;
      const murLin = perim * 2.5;   // ml de murs par niveau (extérieurs + cloisons)
      const fondLin = perim * 1.6;  // ml de semelles et de chaînages
      const nbPoteaux = Math.max(4, Math.round(v.emprise / 12));
      const nbPlanchers = niveaux;  // un plancher haut par niveau (dont la toiture-terrasse)

      const sous = []; // [nom, type, résultat]
      sous.push(['Fondations (semelles)', 'semelle', ELEMENTS.semelle.calcul(
        { longueur: fondLin, largeur: 60, epaisseur: 25, dosage: 350, ferRatio: 70 })]);
      sous.push([`Poteaux (${nbPoteaux * niveaux} u)`, 'poteau', ELEMENTS.poteau.calcul(
        { cote_a: 20, cote_b: 20, hauteur: v.hauteur, nombre: nbPoteaux * niveaux, dosage: 350, ferRatio: 120 })]);
      sous.push(['Chaînages / poutres', 'poutre', ELEMENTS.poutre.calcul(
        { largeur: 20, hauteur: 20, longueur: fondLin * niveaux, nombre: 1, dosage: 350, ferRatio: 130 })]);
      sous.push(['Dalle de sol (RDC)', 'dalle', ELEMENTS.dalle.calcul(
        { longueur: v.emprise, largeur: 1, epaisseur: 12, dosage: 350, ferRatio: 60 })]);

      const surfPlanchers = v.emprise * nbPlanchers;
      if (v.typePlancher === 'hourdis') {
        sous.push([`Planchers hourdis (${nbPlanchers})`, 'hourdis', ELEMENTS.hourdis.calcul(
          { longueur: surfPlanchers, largeur: 1, entrevousM2: 8, betonM2: 0.06, dosage: 350, ferM2: 5 })]);
      } else {
        sous.push([`Planchers dalle pleine (${nbPlanchers})`, 'dalle', ELEMENTS.dalle.calcul(
          { longueur: surfPlanchers, largeur: 1, epaisseur: 15, dosage: 350, ferRatio: 85 })]);
      }

      const surfMurBrute = murLin * v.hauteur * niveaux;
      const ouvertures = surfMurBrute * (v.tauxOuverture / 100);
      sous.push(['Murs en agglos', 'mur', ELEMENTS.mur.calcul(
        { longueur: murLin * niveaux, hauteur: v.hauteur, ouvertures, typeAgglo: 15 })]);

      // Agrégation des matériaux + du fer par diamètre, sur tous les postes
      const materiaux = {};
      const ferDetail = {};
      for (const [, t, r] of sous) {
        for (const k in r.materiaux) materiaux[k] = (materiaux[k] || 0) + r.materiaux[k];
        const part = repartirFer(t, r.materiaux.fer || 0);
        for (const diam in part) ferDetail[diam] = (ferDetail[diam] || 0) + part[diam];
      }

      const labelNiveau = niveaux === 1 ? 'R (plain-pied)' : 'R+' + (niveaux - 1);
      return {
        materiaux,
        ferDetail,
        sousElements: sous,
        details: [
          `${labelNiveau} &middot; emprise ${fmt(v.emprise, 0)} m² &middot; h ${v.hauteur} m`,
          `Hypothèses : ${nbPoteaux} poteaux/niveau, ${fmt(murLin, 0)} ml de murs/niveau, ${fmt(fondLin, 0)} ml de fondations`,
        ],
      };
    },
  },
};

/* ---------------------------------------------------------------------
   4. COÛT & FORMATAGE
   --------------------------------------------------------------------- */
// arrondis « achat réel » : ciment/agglos au nombre entier supérieur
function quantitesAchat(mat) {
  const q = {};
  for (const k in mat) {
    if (k === 'ciment' || k === 'agglo15' || k === 'agglo20' || k === 'entrevous') q[k] = Math.ceil(mat[k]);
    else q[k] = mat[k];
  }
  return q;
}

function coutMateriaux(mat) {
  const q = quantitesAchat(mat);
  let total = 0;
  const lignes = [];
  for (const k in q) {
    if (q[k] <= 0) continue;
    const p = prix[k];
    if (!p) continue;
    const sousTotal = q[k] * p.valeur;
    total += sousTotal;
    lignes.push({ cle: k, label: p.label, unite: p.unite, qte: q[k], pu: p.valeur, sousTotal });
  }
  return { total, lignes };
}

function fmt(n, dec = 0) {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fcfa(n) { return fmt(Math.round(n)) + ' FCFA'; }
function qteAffichee(cle, q) {
  if (cle === 'fer') return fmt(q, 1);
  if (cle === 'sable' || cle === 'gravier') return fmt(q, 2);
  return fmt(q, 0); // ciment, agglos, entrevous = entiers
}

/* Calcule un élément et attache le métré du fer par diamètre.
   (la villa fournit déjà son propre ferDetail agrégé de ses postes) */
function evaluer(type, valeurs) {
  const res = ELEMENTS[type].calcul(valeurs);
  if (!res.ferDetail) res.ferDetail = repartirFer(type, (res.materiaux && res.materiaux.fer) || 0);
  return res;
}

// Convertit un détail fer { HA8: kg, ... } en lignes { diam, kg, ml, barres }
function metreFer(ferDetail) {
  const lignes = [];
  for (const diam of ORDRE_FER) {
    const kg = ferDetail[diam];
    if (!kg || kg <= 0) continue;
    const ml = kg / FER_MASSE[diam];
    const barres = Math.ceil(kg / (FER_MASSE[diam] * LONGUEUR_BARRE));
    lignes.push({ diam, kg, ml, barres });
  }
  return lignes;
}

// Tableau HTML du métré fer ; renvoie '' si pas de fer
function tableFer(ferDetail, titre = 'Métré du fer (barres de 12 m)') {
  const lignes = metreFer(ferDetail || {});
  if (!lignes.length) return '';
  const totalBarres = lignes.reduce((s, l) => s + l.barres, 0);
  const corps = lignes.map((l) => `
    <tr>
      <td><span class="mat-nom"><span class="mat-ico">🔩</span>${l.diam}</span></td>
      <td class="num">${fmt(l.kg, 1)} kg</td>
      <td class="num">${fmt(l.ml, 0)} ml</td>
      <td class="num">${l.barres}</td>
    </tr>`).join('');
  return `
    <p class="badge-detail" style="margin:14px 0 6px">${titre} :</p>
    <table class="mat-table">
      <thead><tr><th>Diamètre</th><th class="num">Poids</th><th class="num">Longueur</th><th class="num">Barres 12 m</th></tr></thead>
      <tbody>${corps}</tbody>
      <tfoot><tr><td>Total</td><td class="num"></td><td class="num"></td><td class="num"><strong>${totalBarres}</strong></td></tr></tfoot>
    </table>`;
}

/* ---------------------------------------------------------------------
   5. ÉTAT & INTERFACE
   --------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
let projet = chargerProjet();

function chargerProjet() {
  try { return JSON.parse(localStorage.getItem('batidevis_projet')) || []; }
  catch { return []; }
}
function sauverProjet() {
  localStorage.setItem('batidevis_projet', JSON.stringify(projet));
}

/* ----- Multi-projets nommés ----- */
let projets = chargerProjets();
let projetCourantId = null;

function chargerProjets() {
  try { return JSON.parse(localStorage.getItem('batidevis_projets')) || []; }
  catch { return []; }
}
function sauverProjets() {
  localStorage.setItem('batidevis_projets', JSON.stringify(projets));
}
function rendreSelectProjets() {
  const sel = $('#select-projet');
  const opts = ['<option value="">📂 Charger un projet…</option>'].concat(
    projets.map((p) => `<option value="${p.id}"${p.id === projetCourantId ? ' selected' : ''}>${p.nom} (${p.elements.length})</option>`));
  sel.innerHTML = opts.join('');
}
function enregistrerProjetNomme() {
  const nom = $('#projet-nom').value.trim();
  if (!nom) { alert('Donne un nom au projet avant d\'enregistrer.'); return; }
  if (!projet.length) { alert('Le projet est vide — ajoute au moins un élément.'); return; }
  const snapshot = structuredClone(projet);
  const existant = projets.find((p) => p.nom.toLowerCase() === nom.toLowerCase());
  if (existant) {
    existant.elements = snapshot;
    existant.date = new Date().toISOString();
    projetCourantId = existant.id;
  } else {
    const id = 'p' + Date.now();
    projets.push({ id, nom, date: new Date().toISOString(), elements: snapshot });
    projetCourantId = id;
  }
  sauverProjets();
  rendreSelectProjets();
  alert('Projet « ' + nom + ' » enregistré.');
}
function chargerProjetNomme(id) {
  const p = projets.find((x) => x.id === id);
  if (!p) return;
  projet = structuredClone(p.elements);
  projetCourantId = id;
  $('#projet-nom').value = p.nom;
  sauverProjet();
  rendreProjet();
}
function supprimerProjetNomme() {
  const id = $('#select-projet').value;
  if (!id) { alert('Choisis d\'abord un projet dans la liste « Charger ».'); return; }
  const p = projets.find((x) => x.id === id);
  if (!p || !confirm('Supprimer définitivement le projet « ' + p.nom + ' » ?')) return;
  projets = projets.filter((x) => x.id !== id);
  if (projetCourantId === id) { projetCourantId = null; $('#projet-nom').value = ''; }
  sauverProjets();
  rendreSelectProjets();
}

/* ----- Construction des champs selon le type d'élément ----- */
function rendreChamps() {
  const type = $('#type-element').value;
  const el = ELEMENTS[type];
  $('#inputs').innerHTML = el.champs.map(champField).join('');
  $('#inputs-avances').innerHTML = el.avances.map(champField).join('');
  $('#resultat').classList.add('hidden');
}

function champField(c) {
  const full = c.full ? ' full' : '';
  const suffixe = c.unite ? ` (${c.unite})` : '';
  if (c.choix) {
    const opts = c.choix.map((o) =>
      `<option value="${o.v}"${o.v === c.def ? ' selected' : ''}>${o.t}</option>`).join('');
    return `<label class="field${full}"><span>${c.label}</span>
      <select id="f-${c.id}" data-id="${c.id}">${opts}</select></label>`;
  }
  return `<label class="field${full}"><span>${c.label}${suffixe}</span>
    <input id="f-${c.id}" data-id="${c.id}" type="number" inputmode="decimal"
      min="0" step="any" value="${c.def}" /></label>`;
}

function lireValeurs() {
  const type = $('#type-element').value;
  const el = ELEMENTS[type];
  const v = {};
  for (const c of [...el.champs, ...el.avances]) {
    const champ = $(`#f-${c.id}`);
    if (!champ) { v[c.id] = c.def; continue; }
    if (c.choix) {
      // select : garder le texte, ou convertir en nombre si les choix sont numériques
      v[c.id] = (typeof c.choix[0].v === 'number') ? Number(champ.value) : champ.value;
    } else {
      v[c.id] = parseFloat(champ.value) || 0;
    }
  }
  return { type, valeurs: v };
}

/* ----- Calcul + affichage du résultat ----- */
function calculerEtAfficher() {
  const { type, valeurs } = lireValeurs();
  const res = evaluer(type, valeurs);
  const cout = coutMateriaux(res.materiaux);
  const q = quantitesAchat(res.materiaux);

  const lignesMat = cout.lignes.map((l) => `
    <tr>
      <td><span class="mat-nom"><span class="mat-ico">${ICONES[l.cle] || '•'}</span>${l.label}</span></td>
      <td class="num">${qteAffichee(l.cle, q[l.cle])} ${l.unite}</td>
      <td class="num">${fmt(l.pu)}</td>
      <td class="num">${fmt(l.sousTotal)}</td>
    </tr>`).join('');

  // Détail par poste (uniquement pour la villa et autres éléments composés)
  let breakdown = '';
  if (res.sousElements) {
    const lignesPoste = res.sousElements.map(([nom, , r]) => `
      <tr>
        <td>${nom}</td>
        <td class="num">${fmt(coutMateriaux(r.materiaux).total)}</td>
      </tr>`).join('');
    breakdown = `
      <p class="badge-detail" style="margin-bottom:6px">Détail par poste (gros œuvre) :</p>
      <table class="mat-table" style="margin-bottom:18px">
        <tbody>${lignesPoste}</tbody>
      </table>`;
  }

  $('#resultat').innerHTML = `
    <h3>${ELEMENTS[type].nom}</h3>
    <p class="sous">${res.details.join(' &middot; ')}</p>
    ${breakdown}
    <table class="mat-table">
      <thead><tr><th>Matériau</th><th class="num">Quantité</th><th class="num">P.U.</th><th class="num">Montant</th></tr></thead>
      <tbody>${lignesMat}</tbody>
    </table>
    ${tableFer(res.ferDetail)}
    <div class="ligne-total">
      <span class="label">Coût total estimé</span>
      <span class="montant">${fcfa(cout.total)}</span>
    </div>`;
  $('#resultat').classList.remove('hidden');
}

/* ----- Ajout au projet ----- */
function ajouterAuProjet() {
  const { type, valeurs } = lireValeurs();
  const res = evaluer(type, valeurs);
  projet.push({
    type,
    nom: ELEMENTS[type].nom,
    resume: res.details[0],
    materiaux: res.materiaux,
    ferDetail: res.ferDetail || {},
  });
  sauverProjet();
  rendreProjet();
  $('#total-projet').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function supprimerItem(i) {
  projet.splice(i, 1);
  sauverProjet();
  rendreProjet();
}

function viderProjet() {
  if (!projet.length) return;
  if (confirm('Vider tout le projet ?')) {
    projet = [];
    sauverProjet();
    rendreProjet();
  }
}

/* ----- Rendu de la liste + récapitulatif ----- */
function rendreProjet() {
  const liste = $('#liste-projet');
  const totalBox = $('#total-projet');

  if (!projet.length) {
    liste.innerHTML = `<p class="projet-vide">Aucun élément. Calcule un élément ci-dessus puis « Ajouter au projet ».</p>`;
    totalBox.classList.add('hidden');
    return;
  }

  liste.innerHTML = projet.map((it, i) => {
    const c = coutMateriaux(it.materiaux);
    return `<div class="item">
      <div class="item-info">
        <h4>${it.nom}</h4>
        <p>${it.resume}</p>
      </div>
      <div class="item-right">
        <span class="item-cout">${fcfa(c.total)}</span>
        <button class="item-suppr" data-i="${i}" aria-label="Supprimer">🗑️</button>
      </div>
    </div>`;
  }).join('');

  // Agrégation de tous les matériaux du projet
  const agg = {};
  for (const it of projet) {
    for (const k in it.materiaux) agg[k] = (agg[k] || 0) + it.materiaux[k];
  }
  const cout = coutMateriaux(agg);
  const q = quantitesAchat(agg);
  const lignes = cout.lignes.map((l) => `
    <tr>
      <td><span class="mat-nom"><span class="mat-ico">${ICONES[l.cle] || '•'}</span>${l.label}</span></td>
      <td class="num">${qteAffichee(l.cle, q[l.cle])} ${l.unite}</td>
      <td class="num">${fmt(l.sousTotal)}</td>
    </tr>`).join('');

  totalBox.innerHTML = `
    <h3>Récapitulatif des matériaux</h3>
    <table class="mat-table">
      <thead><tr><th>Matériau</th><th class="num">Quantité totale</th><th class="num">Montant</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>
    ${tableFer(aggregerFer())}
    <div class="ligne-total">
      <span class="label">Budget matériaux total</span>
      <span class="montant">${fcfa(cout.total)}</span>
    </div>
    <p class="badge-detail">${projet.length} élément(s) &middot; hors main-d'œuvre, transport et accessoires (fil d'attache, eau, coffrage).</p>
    <div class="export-actions">
      <button class="secondary-btn" data-action="whatsapp" type="button">📲 Partager (WhatsApp)</button>
      <button class="secondary-btn" data-action="pdf" type="button">🖨️ Devis PDF</button>
    </div>`;
  totalBox.classList.remove('hidden');
  construireDevisImprimable();
}

/* ----- Agrégation des matériaux du projet (utilitaire partagé) ----- */
function aggregerProjet() {
  const agg = {};
  for (const it of projet) {
    for (const k in it.materiaux) agg[k] = (agg[k] || 0) + it.materiaux[k];
  }
  return agg;
}
function aggregerFer() {
  const agg = {};
  for (const it of projet) {
    const fd = it.ferDetail || {};
    for (const diam in fd) agg[diam] = (agg[diam] || 0) + fd[diam];
  }
  return agg;
}
function texteSimple(html) {
  return String(html).replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&[a-z]+;/g, ' ');
}

/* ----- Export : texte WhatsApp ----- */
function texteDevisProjet() {
  if (!projet.length) return '';
  const agg = aggregerProjet();
  const cout = coutMateriaux(agg);
  const q = quantitesAchat(agg);
  const postes = projet.map((it, i) =>
    `${i + 1}. ${it.nom} — ${fcfa(coutMateriaux(it.materiaux).total)}`);
  const lignes = cout.lignes.map((l) =>
    `• ${l.label} : ${qteAffichee(l.cle, q[l.cle])} ${l.unite} = ${fmt(l.sousTotal)} FCFA`);
  const ferLignes = metreFer(aggregerFer());
  const ferBloc = ferLignes.length ? [
    '',
    '*Fer (barres de 12 m) :*',
    ...ferLignes.map((l) => `• ${l.diam} : ${l.barres} barres (${fmt(l.kg, 0)} kg)`),
  ] : [];
  return [
    '*BÂTIDEVIS — Estimation de matériaux*',
    '',
    '*Postes du projet :*',
    ...postes,
    '',
    '*Matériaux à prévoir :*',
    ...lignes,
    ...ferBloc,
    '',
    `*BUDGET MATÉRIAUX : ${fcfa(cout.total)}*`,
    '',
    "_Estimation hors main-d'œuvre, transport et accessoires. Prix à confirmer auprès du fournisseur._",
    'Fait avec BâtiDevis',
  ].join('\n');
}

function partagerWhatsApp() {
  const t = texteDevisProjet();
  if (!t) { alert('Ajoute au moins un élément au projet.'); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
}

/* ----- Export : devis imprimable (PDF via impression navigateur) ----- */
function construireDevisImprimable() {
  const cont = $('#devis-print');
  if (!projet.length) { cont.innerHTML = ''; return; }
  const agg = aggregerProjet();
  const cout = coutMateriaux(agg);
  const q = quantitesAchat(agg);
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const postes = projet.map((it, i) => `
    <tr>
      <td>${i + 1}. ${it.nom}<br><small>${texteSimple(it.resume)}</small></td>
      <td class="num">${fcfa(coutMateriaux(it.materiaux).total)}</td>
    </tr>`).join('');
  const mats = cout.lignes.map((l) => `
    <tr>
      <td>${l.label}</td>
      <td class="num">${qteAffichee(l.cle, q[l.cle])} ${l.unite}</td>
      <td class="num">${fmt(l.pu)}</td>
      <td class="num">${fmt(l.sousTotal)}</td>
    </tr>`).join('');

  const ferLignes = metreFer(aggregerFer());
  const ferBloc = ferLignes.length ? `
    <h2>Métré du fer (barres de 12 m)</h2>
    <table class="devis-table">
      <thead><tr><th>Diamètre</th><th class="num">Poids</th><th class="num">Longueur</th><th class="num">Barres de 12 m</th></tr></thead>
      <tbody>${ferLignes.map((l) => `
        <tr><td>${l.diam}</td><td class="num">${fmt(l.kg, 1)} kg</td><td class="num">${fmt(l.ml, 0)} ml</td><td class="num">${l.barres}</td></tr>`).join('')}</tbody>
    </table>` : '';

  cont.innerHTML = `
    <div class="devis-entete">
      <h1>BâtiDevis</h1>
      <p>Estimation de matériaux &amp; coûts — ${date}</p>
    </div>
    <h2>Postes du projet</h2>
    <table class="devis-table">
      <thead><tr><th>Élément</th><th class="num">Coût</th></tr></thead>
      <tbody>${postes}</tbody>
    </table>
    <h2>Matériaux à prévoir</h2>
    <table class="devis-table">
      <thead><tr><th>Matériau</th><th class="num">Quantité</th><th class="num">P.U. (FCFA)</th><th class="num">Montant (FCFA)</th></tr></thead>
      <tbody>${mats}</tbody>
    </table>
    ${ferBloc}
    <div class="devis-total"><span>BUDGET MATÉRIAUX TOTAL</span><strong>${fcfa(cout.total)}</strong></div>
    <p class="devis-note">Estimation indicative basée sur les pratiques courantes (béton armé dosé à 350 kg/m³),
    hors main-d'œuvre, transport, coffrage et accessoires. Prix à confirmer auprès du fournisseur et à faire
    valider par un professionnel pour les ouvrages porteurs.</p>`;
}

function imprimerDevis() {
  if (!projet.length) { alert('Ajoute au moins un élément au projet.'); return; }
  construireDevisImprimable();
  window.print();
}

/* ----- Modale des prix ----- */
function ouvrirPrix() {
  $('#prix-grid').innerHTML = Object.keys(prix).map((k) => `
    <label class="field">
      <span>${prix[k].label} — FCFA/${prix[k].unite}</span>
      <input id="p-${k}" type="number" inputmode="numeric" min="0" step="any" value="${prix[k].valeur}" />
    </label>`).join('');
  $('#modale-prix').classList.remove('hidden');
}
function fermerPrix() { $('#modale-prix').classList.add('hidden'); }

function enregistrerPrix() {
  for (const k in prix) {
    const champ = $(`#p-${k}`);
    if (champ) prix[k].valeur = parseFloat(champ.value) || 0;
  }
  sauverPrix();
  fermerPrix();
  rendreProjet();
  if (!$('#resultat').classList.contains('hidden')) calculerEtAfficher();
}
function resetPrix() {
  prix = structuredClone(PRIX_DEFAUT);
  sauverPrix();
  ouvrirPrix();
}

/* ----- Modale fournisseurs (annuaire) ----- */
function rendreFournisseurs() {
  const filtre = $('#filtre-materiau').value;
  const liste = FOURNISSEURS.filter((f) => !filtre || f.mat.includes(filtre));
  const box = $('#liste-fournisseurs');
  if (!liste.length) {
    box.innerHTML = `<p class="projet-vide">Aucun fournisseur pour ce matériau.</p>`;
    return;
  }
  box.innerHTML = liste.map((f) => {
    const tags = f.mat.map((m) => `<span class="tag">${LABEL_MAT[m] || m}</span>`).join('');
    return `<div class="fournisseur">
      <div class="f-info">
        <h4>${f.nom}</h4>
        <p>📍 ${f.zone}</p>
        <div class="tags">${tags}</div>
      </div>
      <div class="f-contact">
        <a class="f-btn wa" href="https://wa.me/${f.tel}" target="_blank" rel="noopener" aria-label="WhatsApp">💬</a>
        <a class="f-btn tel" href="tel:+${f.tel}" aria-label="Appeler">📞</a>
      </div>
    </div>`;
  }).join('');
}
function ouvrirFournisseurs() {
  rendreFournisseurs();
  $('#modale-fournisseurs').classList.remove('hidden');
}
function fermerFournisseurs() { $('#modale-fournisseurs').classList.add('hidden'); }

/* ---------------------------------------------------------------------
   6. ÉVÉNEMENTS
   --------------------------------------------------------------------- */
$('#type-element').addEventListener('change', rendreChamps);
$('#btn-calculer').addEventListener('click', calculerEtAfficher);
$('#btn-ajouter').addEventListener('click', ajouterAuProjet);
$('#btn-vider').addEventListener('click', viderProjet);
$('#btn-enregistrer-projet').addEventListener('click', enregistrerProjetNomme);
$('#select-projet').addEventListener('change', (e) => { if (e.target.value) chargerProjetNomme(e.target.value); });
$('#btn-supprimer-projet').addEventListener('click', supprimerProjetNomme);
$('#liste-projet').addEventListener('click', (e) => {
  const b = e.target.closest('.item-suppr');
  if (b) supprimerItem(parseInt(b.dataset.i, 10));
});
$('#total-projet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  if (b.dataset.action === 'whatsapp') partagerWhatsApp();
  if (b.dataset.action === 'pdf') imprimerDevis();
});
$('#btn-prix').addEventListener('click', ouvrirPrix);
$('#btn-fermer-prix').addEventListener('click', fermerPrix);
$('#btn-enregistrer-prix').addEventListener('click', enregistrerPrix);
$('#btn-reset-prix').addEventListener('click', resetPrix);
$('#modale-prix').addEventListener('click', (e) => { if (e.target.id === 'modale-prix') fermerPrix(); });
$('#btn-fournisseurs').addEventListener('click', ouvrirFournisseurs);
$('#btn-fermer-four').addEventListener('click', fermerFournisseurs);
$('#filtre-materiau').addEventListener('change', rendreFournisseurs);
$('#modale-fournisseurs').addEventListener('click', (e) => { if (e.target.id === 'modale-fournisseurs') fermerFournisseurs(); });

/* ---------------------------------------------------------------------
   7. INITIALISATION
   --------------------------------------------------------------------- */
rendreChamps();
rendreProjet();
rendreSelectProjets();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
