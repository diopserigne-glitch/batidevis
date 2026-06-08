# BâtiDevis — Estimateur de matériaux & coûts (Sénégal)

PWA (application web installable, fonctionne hors-ligne) qui calcule les quantités de
**ciment, fer, sable, gravier et agglos** pour un ouvrage, et estime le **coût en FCFA**
aux prix du marché sénégalais — éditables et sauvegardés sur l'appareil.

## Lancer l'app

Aucune dépendance (HTML/CSS/JS pur). Un simple serveur statique suffit (les service
workers exigent `http://`, pas `file://`) :

```powershell
powershell -ExecutionPolicy Bypass -File server.ps1 8123
```

Puis ouvrir http://localhost:8123/ . Sur téléphone : « Ajouter à l'écran d'accueil ».

## Éléments calculés

| Élément | Entrées | Sorties |
|---|---|---|
| **Villa (R, R+1, R+2)** | emprise, hauteur, niveaux, type de plancher | décomposition auto (fondations, poteaux, chaînages, planchers, murs) + matériaux agrégés |
| Dalle pleine | L × l × épaisseur | béton, ciment, sable, gravier, fer |
| Plancher à hourdis | L × l | entrevous, béton (table), ciment, sable, gravier, fer |
| Mur en agglos | L × H − ouvertures, type 15/20 | agglos, ciment + sable (mortier) |
| Poteau | section × hauteur × nombre | béton armé + fer |
| Poutre / chaînage | section × longueur × nombre | béton armé + fer |
| Semelle de fondation | L × largeur × épaisseur | béton armé + fer |

On ajoute plusieurs éléments à **« Mon projet »** → récapitulatif des matériaux et
**budget total** agrégés, avec :

- **🔩 Métré du fer par diamètre** : le poids d'acier est réparti par diamètre (HA6/HA8/HA10/HA12)
  et converti en **nombre de barres de 12 m** à acheter — par élément et pour tout le projet
- **💾 Multi-projets** : enregistre, recharge et supprime plusieurs devis nommés (stockés sur l'appareil)
- **📲 Partage WhatsApp** : envoie le devis formaté (matériaux + barres de fer) en un clic (`wa.me`)
- **🖨️ Devis PDF** : impression / enregistrement PDF via le navigateur (devis daté et mis en page)
- **🏪 Fournisseurs** : annuaire filtrable par matériau, avec contact WhatsApp / téléphone

### Métré du fer (hypothèses)

Répartition typique du ferraillage par ouvrage : dalle 70 % HA8 / 30 % HA10, hourdis 40/40/20
(HA6/HA8/HA10), poteau 65 % HA12 / 35 % HA8, poutre 70 % HA12 / 30 % HA8, semelle 60 % HA10 /
40 % HA8. Masses linéiques standard (HA8 = 0,395 kg/m, etc.), barres de 12 m. À ajuster selon
le plan de ferraillage réel du BET.

### Hypothèses de la villa (modifiables)

À partir de l'emprise (supposée ~carrée) : périmètre `4·√S`, murs `2,5×` le périmètre par niveau,
fondations/chaînages `1,6×`, 1 poteau 20×20 par ~12 m², un plancher haut par niveau (dont
toiture-terrasse), ouvertures déduites à 18 %. Chaque poste est détaillé et chiffré séparément.

## Hypothèses techniques (modifiables via « Réglages avancés »)

- 1 sac de ciment = 50 kg
- Béton armé dosé à 350 kg/m³ par défaut → 0,40 m³ sable et 0,80 m³ gravier par m³
- Ferraillage indicatif : dalle 85, poteau 120, poutre 130, semelle 70 kg/m³
- Mur : 12,5 agglos/m², mortier de pose dosé à 300 kg/m³
- Coûts **hors** main-d'œuvre, transport, coffrage et accessoires

Les prix par défaut sont indicatifs (Dakar 2026) et **doivent être ajustés** selon le
fournisseur. Estimations à faire valider par un professionnel pour les ouvrages porteurs.

## Pistes suivantes (V4)

- Brancher l'annuaire fournisseurs sur un vrai backend (prix en temps réel par zone) — nécessite
  un serveur/API ; non réalisable dans la PWA hors-ligne actuelle
- Géolocalisation pour proposer les fournisseurs les plus proches
- Réglage manuel du plan de ferraillage (diamètres et nombre de barres par élément)
- Export Excel / CSV du devis pour les entrepreneurs
