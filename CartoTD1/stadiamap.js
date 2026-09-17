function afficherCarteStadia(latitude, longitude, accuracy) {

    var mapStadia = L.map('mapStadia').setView(
        [latitude, longitude],
        13
    );


    L.tileLayer(
        'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png?api_key=eed6a6b4-d171-43e4-8215-e5f8490b4245',
        {
            maxZoom: 20,

            attribution:
                '&copy; Stadia Maps &copy; Stamen Design &copy; OpenStreetMap'
        }
    ).addTo(mapStadia);



    // Marqueur position actuelle

    L.marker([
        latitude,
        longitude
    ]).addTo(mapStadia);



    // Cercle représentant la précision GPS

    L.circle(
        [latitude, longitude],
        {
            radius: accuracy
        }
    )
        .addTo(mapStadia)
        .bindPopup(
            `Précision estimée : ${accuracy} mètres`
        );



    // Nice / Marseille

    recupererMarseilleNice(
        mapStadia,
        latitude,
        longitude
    );



    // Données GeoJSON

    afficherGeoJSON(mapStadia);



    // Trajet Levens -> Sophia Antipolis
    // avec Mapbox

    afficherTrajetMapbox(mapStadia);
}




function recupererMarseilleNice(
    map,
    latitudeUtilisateur,
    longitudeUtilisateur
) {

    let xhrNice = new XMLHttpRequest();


    xhrNice.open(
        'GET',
        'https://geo.api.gouv.fr/communes?nom=Nice&fields=nom,centre&format=json&geometry=centre'
    );


    xhrNice.responseType = 'json';


    xhrNice.onload = function () {

        if (xhrNice.status !== 200) return;


        var nice =
            xhrNice.response[0];


        var longitudeNice =
            nice.centre.coordinates[0];

        var latitudeNice =
            nice.centre.coordinates[1];



        // Trajet entre notre position et Nice
        // avec OSRM

        afficherTrajetOSRM(
            map,

            latitudeUtilisateur,
            longitudeUtilisateur,

            latitudeNice,
            longitudeNice
        );



        let xhrMarseille =
            new XMLHttpRequest();


        xhrMarseille.open(
            'GET',
            'https://geo.api.gouv.fr/communes?nom=Marseille&fields=nom,centre&format=json&geometry=centre'
        );


        xhrMarseille.responseType =
            'json';


        xhrMarseille.onload = function () {

            if (xhrMarseille.status !== 200) {
                return;
            }


            var marseille =
                xhrMarseille.response[0];


            var longitudeMarseille =
                marseille.centre.coordinates[0];

            var latitudeMarseille =
                marseille.centre.coordinates[1];



            // Marqueur Nice

            L.marker([
                latitudeNice,
                longitudeNice
            ])
                .addTo(map)
                .bindPopup("Nice");



            // Marqueur Marseille

            L.marker([
                latitudeMarseille,
                longitudeMarseille
            ])
                .addTo(map)
                .bindPopup("Marseille");



            // Distance entre notre position
            // et Marseille

            var distance =
                distanceGrandCercle(

                    latitudeUtilisateur,
                    longitudeUtilisateur,

                    latitudeMarseille,
                    longitudeMarseille
                );



            // Segment Marseille - Nice
            // avec popup de distance

            L.polyline([

                [
                    latitudeMarseille,
                    longitudeMarseille
                ],

                [
                    latitudeNice,
                    longitudeNice
                ]

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




function distanceGrandCercle(
    lat1,
    lon1,
    lat2,
    lon2
) {

    var R = 6371;


    var latitude1 =
        lat1 * Math.PI / 180;

    var latitude2 =
        lat2 * Math.PI / 180;


    var longitude1 =
        lon1 * Math.PI / 180;

    var longitude2 =
        lon2 * Math.PI / 180;


    var distance = R * Math.acos(

        Math.sin(latitude1) *
        Math.sin(latitude2)

        +

        Math.cos(latitude1) *
        Math.cos(latitude2) *

        Math.cos(
            longitude2 - longitude1
        )
    );


    return distance;
}




function afficherGeoJSON(map) {

    let xhr = new XMLHttpRequest();


    xhr.open(
        'GET',
        'donnees.geojson'
    );


    xhr.responseType = 'json';


    xhr.onload = function () {

        if (xhr.status !== 200) return;


        L.geoJSON(

            xhr.response,

            {

                onEachFeature:
                    function (feature, layer) {

                        if (
                            feature.properties &&
                            feature.properties.nom
                        ) {

                            layer.bindPopup(
                                feature.properties.nom
                            );
                        }
                    }
            }

        ).addTo(map);
    };


    xhr.send();
}




function afficherTrajetOSRM(
    map,

    latitudeDepart,
    longitudeDepart,

    latitudeArrivee,
    longitudeArrivee
) {

    let xhr =
        new XMLHttpRequest();


    let url =

        `https://router.project-osrm.org/route/v1/driving/`

        +

        `${longitudeDepart},${latitudeDepart};`

        +

        `${longitudeArrivee},${latitudeArrivee}`

        +

        `?overview=full&geometries=geojson`;



    xhr.open(
        'GET',
        url
    );


    xhr.responseType = 'json';


    xhr.onload = function () {

        if (xhr.status !== 200) return;


        if (
            xhr.response.code !== "Ok"
        ) {
            return;
        }


        var route =
            xhr.response.routes[0];


        var distance =
            route.distance / 1000;


        var duree =
            route.duration / 60;



        L.geoJSON(

            route.geometry,

            {
                style: {
                    weight: 5
                }
            }

        )
            .addTo(map)
            .bindPopup(

                `Trajet position actuelle → Nice avec OSRM<br>` +

                `Distance : ${distance.toFixed(2)} km<br>` +

                `Durée : ${duree.toFixed(0)} minutes`
            );
    };


    xhr.send();
}




function afficherTrajetMapbox(map) {

    var tokenMapbox =
        'pk.eyJ1IjoiY3YwNiIsImEiOiJjajg2MmpzYjcwbWdnMzNsc2NzM2l4eW0yIn0.TfDJipR5II7orUZaC848YA';


    rechercherLieuMapbox(
        "Levens, France",
        tokenMapbox,
        function (coordLevens) {

            var longitudeLevens = coordLevens[0];
            var latitudeLevens = coordLevens[1];


            // Coordonnées de Sophia Antipolis
            var latitudeSophia = 43.616513;
            var longitudeSophia = 7.072094;


            let xhr = new XMLHttpRequest();


            let url =
                `https://api.mapbox.com/directions/v5/mapbox/driving/` +
                `${longitudeLevens},${latitudeLevens};` +
                `${longitudeSophia},${latitudeSophia}` +
                `?geometries=geojson` +
                `&overview=full` +
                `&access_token=${tokenMapbox}`;


            xhr.open('GET', url);

            xhr.responseType = 'json';


            xhr.onload = function () {

                if (xhr.status !== 200) {
                    return;
                }

                if (xhr.response.code !== "Ok") {
                    return;
                }


                var route = xhr.response.routes[0];

                var distance = route.distance / 1000;

                var duree = route.duration / 60;


                L.geoJSON(route.geometry)
                    .addTo(map)
                    .bindPopup(
                        `Trajet Levens → Sophia Antipolis avec Mapbox<br>` +
                        `Distance : ${distance.toFixed(2)} km<br>` +
                        `Durée : ${duree.toFixed(0)} minutes`
                    );
            };


            xhr.send();
        }
    );
}




function rechercherLieuMapbox(
    nomLieu,
    tokenMapbox,
    callback
) {

    let xhr =
        new XMLHttpRequest();



    let url =

        `https://api.mapbox.com/search/geocode/v6/forward`

        +

        `?q=${encodeURIComponent(nomLieu)}`

        +

        `&country=fr`

        +

        `&limit=1`

        +

        `&access_token=${tokenMapbox}`;



    xhr.open(
        'GET',
        url
    );


    xhr.responseType =
        'json';



    xhr.onload = function () {

        if (xhr.status !== 200) {
            return;
        }


        if (
            xhr.response.features.length === 0
        ) {
            return;
        }



        var coordinates =
            xhr.response.features[0]
                .geometry
                .coordinates;



        callback(coordinates);
    };


    xhr.send();
}