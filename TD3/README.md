# TD3 — Géolocalisation et 3D

Réalisé à partir du cours GeoLoc3 et du TD3 2026-2027, avec Three.js et Leaflet.

Depuis la racine du dépôt :

```sh
python -m http.server 8000
```

Ouvrir http://localhost:8000/TD3/ dans le navigateur.

## Exercice 1

- `index.html` et `main.js` : scène, caméra, lumière ambiante, sphère de rayon 1 et texture terrestre.
- Conversion latitude/longitude en XYZ, avec Y vers le nord et Z orienté selon la texture.
- Position de l’utilisateur en rouge et cinq cubes texturés avec les drapeaux des pays, qui tournent sur eux-mêmes.
- Glissement avec la souris ou le doigt : rotation de la Terre et de ses marqueurs.
- Clic sur la carte ou un marqueur : orientation de la Terre vers ce point.
- Clic sur un cube visible en 3D : recentrage de Leaflet et ouverture de son nom. Un glissement ne sélectionne pas de pays.

L’appel REST Countries indiqué dans le cours est conservé. Cette ancienne API peut renvoyer une erreur ou un message de dépréciation ; `countries.json` fournit alors les cinq pays de secours au même format. Ces coordonnées viennent de [mledoze/countries](https://github.com/mledoze/countries) (ODbL), et les drapeaux de [FlagCDN](https://flagcdn.com/). Les bibliothèques, drapeaux et tuiles de carte nécessitent Internet.

## Exercice 2

`camera.html` et `camera.js` affichent le flux de la caméra arrière et des cubes géolocalisés. `watchPosition` suit les déplacements ; les angles du téléphone orientent la caméra Three.js.

Les quatre cubes de démonstration sont placés à 50 m autour de la première position GPS. Ils conservent leurs coordonnées quand l’utilisateur se déplace. Rouge : nord ; vert : est ; bleu : sud ; orange : ouest. L’amélioration consiste à ajouter des cubes jaunes en cliquant sur la petite carte, à moins de 1 km de sa position.

La conversion locale utilise des mètres : X vers l’est, Y vers le haut, Z vers le sud. Elle convient aux petites distances. Les objets sont placés à hauteur de caméra, sans prise en compte du relief. La précision dépend du GPS et des capteurs ; le champ de vision est approximatif.

Pour vérifier sur un smartphone :

1. Ouvrir `TD3/camera.html` depuis une adresse HTTPS. Une adresse HTTP sur le réseau local ne suffit pas pour les capteurs.
2. Appuyer sur « Démarrer » et autoriser caméra, position et orientation.
3. Si nécessaire, viser le nord avec la caméra arrière et appuyer sur « calibrer ».
4. Tourner le téléphone pour voir les quatre cubes, puis se déplacer pour vérifier qu’ils restent à leur position.
5. Ajouter un point sur la carte et regarder dans sa direction. Vérifier aussi en mode paysage.

Le principe suit l’exemple [AR.js location-based](https://ar-js-org.github.io/AR.js-Docs/location-based/) cité par le TD, avec les API du navigateur et Three.js directement.

## Vérifications effectuées

Syntaxe JavaScript et essais dans Edge : chargement des pays et secours local, animation des cubes texturés, rotation à la souris et au doigt, interactions carte/globe, exclusion des cubes cachés, affichage mobile, caméra simulée, déplacements GPS simulés, orientation, calibration et refus d’autorisations. Le test avec la caméra et les capteurs d’un vrai smartphone reste à effectuer.
