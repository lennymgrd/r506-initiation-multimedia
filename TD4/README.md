# Flight Explorer 3D

Application web de suivi aérien en temps réel sur un globe terrestre 3D photoréaliste, réalisée dans le cadre du cours **« Sensibilisation à la programmation multimédia » (BUT3)**.

Flight Explorer 3D combine la consultation de positions d’avions réellement détectés en vol via l’API ouverte **[ADSB.fi](https://adsb.fi/)** et une visualisation 3D interactive propulsée par **CesiumJS** et les **Google Photorealistic 3D Tiles**.

---

## 1. Technologies utilisées

- **HTML5 / CSS3 / JavaScript moderne (ES2022+)** — aucun framework frontend (ni React, ni Vue, ni Angular) afin de conserver un code lisible, léger et directement explicable.
- **[CesiumJS](https://cesium.com/platform/cesiumjs/)** — moteur cartographique 3D WebGL principal (globe WGS84, Google Photorealistic 3D Tiles, billboards orientés, modèle 3D glTF/GLB, caméras et géocodeur).
- **[ADSB.fi Open Data API](https://github.com/adsbfi/opendata)** — source primaire de télémétrie ADS-B temps réel (`/v3/lat/{lat}/lon/{lon}/dist/{dist}` et `/v2/callsign/{callsign}`).
- **[Vite](https://vitejs.dev/)** — serveur de développement, proxy local de développement et compilateur de production.
- **[Vitest](https://vitest.dev/)** — tests unitaires automatisés pour la normalisation des données, les conversions aéronautiques, l’interpolation et le client réseau.
- **API Web natives** : `fetch` + `AbortController`, `localStorage`, `navigator.geolocation` (position GPS de l’utilisateur), `DeviceOrientationEvent` (gyroscope smartphone en vue cockpit).

---

## 2. Fonctionnalités

### Globe terrestre 3D (CesiumJS)
- **Qualité élevée** : affichage des **Google Photorealistic 3D Tiles** via Cesium ion (`createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true })`).
- **Qualité légère (et repli automatique)** : globe Cesium classique avec imagerie Bing Maps (si le token Cesium ion est présent) ou imagerie **Natural Earth II** embarquée hors-ligne. Un échec de chargement des tuiles Google ou l’absence de token ne provoque jamais un écran vide.
- **Recherche de lieu** via `IonGeocoderService` configuré automatiquement avec le fournisseur `GOOGLE` lorsque les tuiles Google sont actives.
- **Boutons rapides** : retour à la **Vue mondiale** et centrage sur **Ma position** (géolocalisation HTML5).

### Récupération et traitement des vols (ADSB.fi)
- Interrogation de la région géographique réellement consultée à l’écran (`/v3/lat/{lat}/lon/{lon}/dist/{dist}`, rayon adapté à l’altitude de la caméra jusqu’à 250 NM).
- **Stabilisation et limitation de débit** : délai de stabilisation de 1,5 s après un déplacement de caméra, file d’attente garantissant au maximum 1 requête / seconde, actualisation périodique configurable (15 s, 30 s, 60 s, 120 s), ralentissement lorsque l’onglet est en arrière-plan et temporisation exponentielle en cas d’erreur `HTTP 429`.
- **Conversions et validations** :
  - Altitudes en pieds (`alt_baro`, `alt_geom`) converties en mètres (`m`) ou affichées en pieds (`ft`).
  - Vitesses sol en nœuds (`gs`) converties en `km/h` ou affichées en `kt`.
  - Déduction du pays d’immatriculation à partir du bloc d’adresse OACI 24 bits (`hex`).
  - Affichage explicite `Non disponible` lorsqu’un champ est absent, sans jamais inventer d’aéroport de départ, de destination ou de compagnie.

### Liste interactive, recherche et filtres
- Panneau latéral intitulé **« Vols dans la zone »** avec compteur d’avions, indicateur de chargement et message explicite si aucun avion n’est détecté.
- **Recherche locale instantanée** (par indicatif, adresse hex OACI, immatriculation, code type ou pays).
- **Recherche distante explicite par indicatif** (`/v2/callsign/{callsign}`) via le bouton **API Indicatif**, clairement distinguée du filtre local.
- **Filtres et tris** : filtre par préfixe d’indicatif OACI, case à cocher pour inclure/masquer les avions au sol, tri par indicatif, altitude ou vitesse.

### Sélection, suivi 3D et 3 modes de caméra
- **Avions non sélectionnés** : marqueurs vectoriels légers (`BillboardCollection`) orientés selon le cap réel (`track`) et colorés selon l’altitude.
- **Avion sélectionné** : modèle 3D glTF binaire léger (`public/models/airplane.glb`, 412 triangles, généré sans dépendance de licence par `scripts/generate-airplane-model.mjs`), silhouette mise en évidence et sillages des positions reçues.
- **Interpolation et estime** : extrapolation bornée entre deux relevés ADS-B et lissage (`smoothstep`) pour éviter toute téléportation visuelle.
- **Trois modes de caméra** :
  1. **Vue globale** : navigation libre autour du globe avec rapprochement initial vers l’appareil.
  2. **Vue extérieure** : caméra placée derrière et légèrement au-dessus de l’avion, accompagnant son déplacement et son cap (orientable à la souris ou au doigt + zoom à la molette).
  3. **Vue cockpit virtuelle** : caméra placée à l’avant de l’appareil avec bandeau explicite **« Vue cockpit virtuelle simulée (non embarquée) »**, rotation du regard au doigt/souris et option **Orientation smartphone** (`DeviceOrientationEvent` après autorisation explicite).

---

## 3. Architecture du projet

```text
flight-explorer-3d/
├── index.html                        # Structure HTML5 responsive (3 zones)
├── package.json                      # Scripts npm et dépendances
├── vite.config.js                    # Configuration Vite, base GitHub Pages et proxy local
├── .env.example                      # Modèle de configuration des variables d'environnement
├── .gitignore
├── README.md
├── public/
│   └── models/
│       └── airplane.glb              # Modèle 3D léger de l'avion sélectionné (23 Ko)
├── scripts/
│   ├── copy-cesium-assets.mjs        # Copie automatique de Workers/Assets/Widgets Cesium
│   └── generate-airplane-model.mjs   # Générateur du modèle 3D airplane.glb
├── serverless/
│   └── cloudflare-worker.js          # Relais CORS minimal optionnel pour GitHub Pages
├── src/
│   ├── main.js                       # Orchestrateur principal
│   ├── style.css                     # Thème sombre aéronautique et règles responsive
│   ├── config/
│   │   └── settings.js               # Constantes et configuration centralisées
│   ├── state/
│   │   └── appState.js               # Store d'état unique et sauvegarde localStorage
│   ├── services/
│   │   └── adsbApi.js                # Client REST ADSB.fi avec file d'attente 1 req/s
│   ├── globe/
│   │   ├── globe.js                  # Initialisation CesiumJS, Google 3D Tiles et mode léger
│   │   ├── aircraft.js               # Billboards orientés, modèle 3D GLB, sillage et lissage
│   │   └── camera.js                 # Caméras globale, extérieure, cockpit et gyroscope
│   ├── ui/
│   │   ├── flightList.js             # Menu latéral, recherche locale/distante, filtres et tri
│   │   ├── flightDetails.js          # Fiche détaillée de l'avion et boutons de caméra
│   │   └── controls.js               # Barre supérieure, bandeaux d'alerte, géocodeur et modale
│   ├── utils/
│   │   ├── flightUtils.js            # Conversions, normalisation, fusion et trigonométrie
│   │   └── icaoCountries.js          # Table des blocs d'adresses OACI par pays
│   └── data/
│       └── demoFlights.js            # Jeu de démonstration local (identifié DEMO)
├── tests/
│   ├── flightUtils.test.js           # Tests unitaires des utilitaires et conversions
│   └── adsbApi.test.js               # Tests unitaires du client réseau et du limiteur
└── .github/
    └── workflows/
        └── deploy.yml                # Déploiement continu sur GitHub Pages
```

---

## 4. Installation et démarrage local

### Prérequis
- **Node.js** 20+ et **npm** 10+

### Installation
```bash
npm install
```
*(Lors de `npm run dev` ou `npm run build`, le script `scripts/copy-cesium-assets.mjs` copie automatiquement les dossiers `Workers`, `ThirdParty`, `Assets` et `Widgets` de Cesium dans `public/cesium/`.)*

### Configuration du token Cesium ion
1. Copiez le fichier `.env.example` en `.env` :
   ```bash
   cp .env.example .env
   ```
2. Créez un compte gratuit sur [Cesium ion](https://ion.cesium.com/) et générez un token sur <https://ion.cesium.com/tokens>.
3. Renseignez-le dans `.env` :
   ```env
   VITE_CESIUM_ION_TOKEN=votre_token_cesium_ion_ici
   ```

> **Note de sécurité importante sur les variables Vite (`VITE_*`) :**
> Tout identifiant lu côté navigateur est inclus dans le bundle JavaScript final et est donc visible dans l’inspecteur réseau des visiteurs. Ne considérez jamais `.env` comme un coffre-fort côté client :
> - Créez un **token dédié** uniquement à cette application ;
> - Limitez ses droits aux seules permissions nécessaires (`assets:read`, `geocode`) ;
> - Activez la **restriction d’URL (Allowed URLs)** sur Cesium ion vers votre domaine `https://<votre-utilisateur>.github.io`.
> - Si aucun token n’est fourni, l’application démarre automatiquement en **Qualité légère** (globe Natural Earth II hors-ligne).

### Commandes disponibles
```bash
# Lancer le serveur de développement local (avec proxy ADSB.fi intégré)
npm run dev

# Exécuter la suite de tests unitaires
npm test

# Compiler l'application pour la production dans dist/
npm run build

# Prévisualiser la version compilée localement
npm run preview
```

---

## 5. Sources des données, limitations de l’API et gestion du CORS

### Conditions d’utilisation d’ADSB.fi
- Documentation officielle : <https://github.com/adsbfi/opendata>
- Usage strictement **personnel et non commercial**, avec attribution visible et lien vers <https://adsb.fi/> (présent en permanence dans la barre inférieure de l’application).
- **Limitation de fréquence** : **1 requête par seconde** maximum sur les endpoints publics. Les requêtes invalides (`400`, `404`, `429`) comptent dans ce quota : l’application valide donc chaque indicatif avant tout appel réseau et sérialise les requêtes avec un espacement minimal de `1,1 s`.

### Accès depuis le navigateur et politique CORS
Lors des vérifications techniques sur `https://opendata.adsb.fi/api/v3/...`, le serveur d’ADSB.fi répond en `HTTP 200 application/json` mais **n’inclut pas l’en-tête HTTP `Access-Control-Allow-Origin`**. Par conséquent :
1. **En développement local (`npm run dev` / `npm run preview`)** : Vite relaie automatiquement `/adsb-api/*` vers `https://opendata.adsb.fi/api/*` (voir `vite.config.js`). Les avions en direct s’affichent immédiatement sans configuration supplémentaire.
2. **Sur GitHub Pages (hébergement statique cross-origin)** : un appel direct du navigateur depuis `https://utilisateur.github.io` vers `https://opendata.adsb.fi` est bloqué par la sécurité CORS du navigateur. Conformément aux bonnes pratiques :
   - L’application **n’utilise aucun proxy public tiers non officiel** ;
   - Si le navigateur bloque la requête, un bandeau explicite indique la cause réelle et propose d’activer le **Mode démo** en un clic ;
   - Pour disposer des données réelles sur GitHub Pages, vous pouvez déployer gratuitement le relais serverless minimal de 40 lignes fourni dans [`serverless/cloudflare-worker.js`](./serverless/cloudflare-worker.js) sur Cloudflare Workers (offre gratuite sans carte bancaire) et définir son URL dans la variable `VITE_ADSB_API_BASE`.

---

## 6. Différence entre le Mode direct et le Mode démo

| Caractéristique | Mode direct (`ADSB.fi`) | Mode démo (local) |
| :--- | :--- | :--- |
| **Source des données** | API temps réel `opendata.adsb.fi` | Générateur local `src/data/demoFlights.js` |
| **Identification visuelle** | Pastille verte **« En direct · ADSB.fi »** | Pastille ambre **« Mode démo (données fictives) »** + badge `DÉMO FICTIVE` |
| **Indicatifs et codes hex** | Indicatifs OACI réels (`AFR…`, `DLH…`, `EWG…`) | Indicatifs préfixés `DEMO01` à `DEMO12` (`hex` `DE0001`…) |
| **Activation** | Par défaut au lancement | Uniquement sur action explicite de l’utilisateur (bouton **Mode démo** ou Paramètres) |

Aucune donnée fictive n’est jamais présentée comme un vol réel en direct.

---

## 7. Publication sur GitHub Pages

Le dépôt contient le workflow GitHub Actions [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) qui exécute les tests unitaires, compile le projet avec le bon sous-répertoire (`BASE_PATH=/<nom-du-dépôt>/`) et publie l’artefact sur GitHub Pages :

1. Dans votre dépôt GitHub, ouvrez **Settings → Pages** et choisissez **Source : GitHub Actions**.
2. Dans **Settings → Secrets and variables → Actions** :
   - Ajoutez le secret `VITE_CESIUM_ION_TOKEN` avec votre token Cesium ion restreint par domaine ;
   - *(Optionnel)* Ajoutez la variable `VITE_ADSB_API_BASE` pointant vers votre Worker Cloudflare si vous souhaitez activer les appels directs ADSB.fi sur GitHub Pages.
3. Poussez sur la branche `main` (ou déclenchez le workflow manuellement depuis l’onglet **Actions**).

