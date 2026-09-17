function afficherCarteStadia(latitude, longitude, accuracy) {

    var mapStadia = L.map('mapStadia').setView(
        [latitude, longitude],
        13
    );

    L.tileLayer(
        'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png?api_key=TON_TOKEN',
        {
            maxZoom: 20,
            attribution: '&copy; Stadia Maps &copy; Stamen Design &copy; OpenStreetMap'
        }
    ).addTo(mapStadia);

    // Marqueur position actuelle
    L.marker([latitude, longitude]).addTo(mapStadia);

    // Cercle de précision
    L.circle([latitude, longitude], {
        radius: accuracy
    }).addTo(mapStadia);

    // Partie Marseille / Nice
    recupererMarseilleNice(mapStadia, latitude, longitude);
}

function recupererMarseilleNice(map, latitudeUtilisateur, longitudeUtilisateur) {

    let xhrNice = new XMLHttpRequest();

    xhrNice.open(
        'GET',
        'https://geo.api.gouv.fr/communes?nom=Nice&fields=nom,centre&format=json&geometry=centre'
    );

    xhrNice.responseType = 'json';

    xhrNice.onload = function() {

        if (xhrNice.status !== 200) return;

        var nice = xhrNice.response[0];

        var longitudeNice = nice.centre.coordinates[0];
        var latitudeNice = nice.centre.coordinates[1];


        let xhrMarseille = new XMLHttpRequest();

        xhrMarseille.open(
            'GET',
            'https://geo.api.gouv.fr/communes?nom=Marseille&fields=nom,centre&format=json&geometry=centre'
        );

        xhrMarseille.responseType = 'json';

        xhrMarseille.onload = function() {

            if (xhrMarseille.status !== 200) return;

            var marseille = xhrMarseille.response[0];

            var longitudeMarseille = marseille.centre.coordinates[0];
            var latitudeMarseille = marseille.centre.coordinates[1];


            // Marqueur Nice
            L.marker([latitudeNice, longitudeNice])
                .addTo(map);


            // Calcul de la distance entre Marseille et notre position
            var distance = distanceGrandCercle(
                latitudeUtilisateur,
                longitudeUtilisateur,
                latitudeMarseille,
                longitudeMarseille
            );

             // Marqueur Marseille + Popup
            L.marker([latitudeMarseille, longitudeMarseille])
                .addTo(map);


            L.polyline([
             [latitudeMarseille, longitudeMarseille],
             [latitudeNice, longitudeNice]
            ])
                .addTo(map)
                .bindPopup(
                `Distance entre notre position et Marseille : ${distance.toFixed(2)} km`
            );

        };

        xhrMarseille.send();
    };

    xhrNice.send();
}

function distanceGrandCercle(lat1, lon1, lat2, lon2) {

    var R = 6371;

    var latitude1 = lat1 * Math.PI / 180;
    var latitude2 = lat2 * Math.PI / 180;

    var longitude1 = lon1 * Math.PI / 180;
    var longitude2 = lon2 * Math.PI / 180;

    var distance = R * Math.acos(
        Math.sin(latitude1) * Math.sin(latitude2) +
        Math.cos(latitude1) * Math.cos(latitude2) *
        Math.cos(longitude2 - longitude1)
    );

    return distance;
}
