/**
 * Affichage des avions sur le globe.
 *
 *  - Avions non sélectionnés : billboards (images 2D) légers, orientés selon le cap,
 *    regroupés dans une BillboardCollection (un seul appel de dessin pour tous).
 *  - Avion sélectionné : modèle glTF léger + traînée des positions reçues.
 *  - Mouvement : estime (vitesse + cap) bornée dans le temps, et lissage entre
 *    l'ancienne position affichée et la nouvelle position reçue (pas de téléportation).
 *
 * Les objets Cesium sont créés une seule fois par avion puis mis à jour ;
 * ils sont supprimés lorsque l'avion disparaît des données.
 */
import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  Ellipsoid,
  HeadingPitchRoll,
  HeightReference,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  Model,
  NearFarScalar,
  PointPrimitiveCollection,
  PolylineCollection,
  Transforms,
  VerticalOrigin,
} from 'cesium';
import { SETTINGS } from '../config/settings.js';
import {
  distanceNm,
  extrapolatePosition,
  interpolateHeading,
  interpolatePositions,
} from '../utils/flightUtils.js';

/** Silhouette d'avion (pointant vers le haut = nord), dessinée par nos soins. */
export const PLANE_PATH = 'M12 2c.8 0 1.3.8 1.3 1.8V9l8.2 4.8v2l-8.2-2.4v5.2l2.3 1.7V22L12 21l-3.6 1v-1.7l2.3-1.7v-5.2l-8.2 2.4v-2L10.7 9V3.8C10.7 2.8 11.2 2 12 2z';

/** Génère l'image d'un marqueur (blanche, teintée ensuite par billboard.color). */
function createPlaneImage({ size = 64, fill = '#ffffff', glow = null }) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const path = new Path2D(PLANE_PATH);
  ctx.scale(size / 24, size / 24);
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 3;
  }
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4, 12, 24, 0.9)';
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
  // Une URL de données sert de clé : Cesium ne stocke l'image qu'une fois dans son atlas.
  return canvas.toDataURL('image/png');
}

/** Couleur selon l'altitude (comme sur les sites de suivi aérien). */
const ALTITUDE_STOPS = [
  [0, Color.fromCssColorString('#7CFFB2')],
  [10_000, Color.fromCssColorString('#3FE0FF')],
  [25_000, Color.fromCssColorString('#5AA9FF')],
  [40_000, Color.fromCssColorString('#C9B6FF')],
];
const GROUND_COLOR = Color.fromCssColorString('#8C9AAE');
const SELECTED_COLOR = Color.fromCssColorString('#FFB020');

export function altitudeColor(altitudeFt, onGround, result = new Color()) {
  if (onGround || altitudeFt === null) return Color.clone(GROUND_COLOR, result);
  for (let i = 1; i < ALTITUDE_STOPS.length; i += 1) {
    const [maxAlt, maxColor] = ALTITUDE_STOPS[i];
    if (altitudeFt <= maxAlt) {
      const [minAlt, minColor] = ALTITUDE_STOPS[i - 1];
      return Color.lerp(minColor, maxColor, (altitudeFt - minAlt) / (maxAlt - minAlt), result);
    }
  }
  return Color.clone(ALTITUDE_STOPS.at(-1)[1], result);
}

// Objets temporaires réutilisés à chaque image (évite de surcharger le ramasse-miettes).
const scratchNormal = new Cartesian3();
const scratchEast = new Cartesian3();
const scratchNorth = new Cartesian3();
const scratchHpr = new HeadingPitchRoll();

/** Vecteur "nord" local : sert d'axe d'alignement pour orienter les billboards. */
function localNorth(position, result) {
  Ellipsoid.WGS84.geodeticSurfaceNormal(position, scratchNormal);
  Cartesian3.cross(Cartesian3.UNIT_Z, scratchNormal, scratchEast);
  if (Cartesian3.magnitudeSquared(scratchEast) < 1e-12) return Cartesian3.clone(Cartesian3.UNIT_Y, result);
  Cartesian3.normalize(scratchEast, scratchEast);
  return Cartesian3.normalize(Cartesian3.cross(scratchNormal, scratchEast, result), result);
}

/**
 * @param {import('cesium').Scene} scene
 * @param {{ lowPower?: boolean, onModelError?: (error: unknown) => void }} [options]
 */
export function createAircraftLayer(scene, { lowPower = false, onModelError } = {}) {
  const images = {
    normal: createPlaneImage({}),
    selected: createPlaneImage({ fill: '#ffffff', glow: '#FFB020' }),
  };

  const billboards = scene.primitives.add(new BillboardCollection({ scene }));
  const labels = scene.primitives.add(new LabelCollection({ scene }));
  const trailCollection = scene.primitives.add(new PolylineCollection());
  const lastFixCollection = scene.primitives.add(new PointPrimitiveCollection());

  /** @type {Map<string, object>} état d'affichage par avion */
  const entries = new Map();
  let selectedId = null;
  let showLabels = true;
  let showGround = true;
  let modelVisible = true;
  let model = null;
  let modelFailed = false;
  let trail = null;
  let trailPositions = [];
  let lastFix = null;
  let lastBulkUpdateMs = 0;
  let needsFullUpdate = true;

  loadModel();

  async function loadModel() {
    try {
      model = await Model.fromGltfAsync({
        url: SETTINGS.model.url,
        scale: SETTINGS.model.scale,
        minimumPixelSize: SETTINGS.model.minimumPixelSize,
        maximumScale: 20_000,
        silhouetteColor: SELECTED_COLOR,
        silhouetteSize: 1.5,
        show: false,
      });
      scene.primitives.add(model);
      model.errorEvent?.addEventListener((error) => failModel(error));
    } catch (error) {
      failModel(error);
    }
  }

  function failModel(error) {
    modelFailed = true;
    if (model) model.show = false;
    console.warn('[aircraft] Modèle 3D introuvable, représentation simplifiée utilisée :', error);
    onModelError?.(error);
  }

  function createEntry(flight) {
    const billboard = billboards.add({
      id: flight.id,
      image: images.normal,
      width: 26,
      height: 26,
      verticalOrigin: VerticalOrigin.CENTER,
      horizontalOrigin: HorizontalOrigin.CENTER,
      scaleByDistance: new NearFarScalar(2.0e5, 1.2, 8.0e6, 0.55),
      // Évite que les marqueurs soient masqués par le relief ou les bâtiments proches.
      disableDepthTestDistance: 150_000,
    });
    const label = labels.add({
      id: flight.id,
      text: '',
      font: '600 12px "Inter", system-ui, sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString('#04101e'),
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cartesian2(0, -24),
      verticalOrigin: VerticalOrigin.BOTTOM,
      distanceDisplayCondition: new DistanceDisplayCondition(0, 450_000),
      disableDepthTestDistance: 150_000,
      show: false,
    });
    return {
      id: flight.id,
      billboard,
      label,
      data: null,
      missing: false,
      from: null,
      blendStartMs: 0,
      display: null,
      position: new Cartesian3(),
      color: new Color(),
    };
  }

  function removeEntry(entry) {
    billboards.remove(entry.billboard);
    labels.remove(entry.label);
    entries.delete(entry.id);
  }

  /** Applique un nouveau relevé à un avion (avec lissage depuis la position affichée). */
  function applyData(entry, data, missing, nowMs) {
    const previous = entry.data;
    entry.missing = missing;
    if (previous === data) return;
    entry.data = data;
    if (entry.display && previous) {
      const jumpNm = distanceNm(entry.display.lat, entry.display.lon, data.lat, data.lon);
      // Lissage seulement pour un déplacement plausible (sinon : placement direct).
      entry.from = jumpNm < 15 ? { ...entry.display } : null;
      entry.blendStartMs = nowMs;
    }
    const ground = data.onGround;
    entry.billboard.heightReference = ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE;
    entry.label.heightReference = entry.billboard.heightReference;
    entry.label.text = data.callsign ?? data.registration ?? data.hex;
    altitudeColor(data.altitudeFt, ground, entry.color);
    if (!entry.display) {
      entry.display = extrapolatePosition(data, nowMs, SETTINGS.flights.maxExtrapolationS);
      entry.display.headingDeg = data.trackDeg;
      Cartesian3.fromDegrees(
        entry.display.lon,
        entry.display.lat,
        ground ? 0 : entry.display.altitudeM,
        Ellipsoid.WGS84,
        entry.position,
      );
    }
  }

  /** Calcule la position affichée d'un avion à l'instant `nowMs`. */
  function computeDisplay(entry, nowMs) {
    const { data } = entry;
    const target = extrapolatePosition(data, nowMs, SETTINGS.flights.maxExtrapolationS);
    target.headingDeg = data.trackDeg;
    if (!entry.from) return target;
    const t = (nowMs - entry.blendStartMs) / (SETTINGS.flights.blendDurationS * 1000);
    if (t >= 1) {
      entry.from = null;
      return target;
    }
    const blended = interpolatePositions(entry.from, target, t);
    blended.headingDeg = interpolateHeading(entry.from.headingDeg, target.headingDeg, t);
    return blended;
  }

  function updateEntryVisual(entry) {
    const { billboard, label, data } = entry;
    const isSelected = entry.id === selectedId;
    // Lorsqu'un avion est en cours de suivi, on masque les autres appareils sur le globe.
    const visible = selectedId ? isSelected : (showGround || !data.onGround);
    const useModel = isSelected && model && !modelFailed && model.ready;

    billboard.show = visible && !useModel && modelVisible;
    billboard.image = isSelected ? images.selected : images.normal;
    billboard.width = isSelected ? 34 : 26;
    billboard.height = isSelected ? 34 : 26;
    billboard.color = isSelected ? SELECTED_COLOR : entry.color;
    billboard.color.alpha = entry.missing ? 0.45 : 1;

    label.show = visible && modelVisible && (isSelected || showLabels);
    label.fillColor = isSelected ? SELECTED_COLOR : Color.WHITE;
    label.distanceDisplayCondition = isSelected ? undefined : new DistanceDisplayCondition(0, 450_000);
    label.pixelOffset = new Cartesian2(0, isSelected && useModel ? -36 : -22);
  }

  /** Met à jour la traînée et le dernier point reçu de l'avion sélectionné. */
  function updateSelectedTrack(entry, received) {
    if (!entry) return;
    if (received) {
      const { data } = entry;
      const point = Cartesian3.fromDegrees(data.lon, data.lat, data.onGround ? 0 : extrapolatePosition(data, data.positionTimeMs).altitudeM);
      const last = trailPositions.at(-1);
      if (!last || !Cartesian3.equalsEpsilon(last, point, 0, 1)) trailPositions.push(point);
      if (trailPositions.length > 240) trailPositions.shift();
      if (!lastFix) {
        lastFix = lastFixCollection.add({ pixelSize: 7, color: SELECTED_COLOR, outlineColor: Color.BLACK, outlineWidth: 1, disableDepthTestDistance: 150_000 });
      }
      lastFix.position = point;
    }
    if (!trail) {
      trail = trailCollection.add({ width: 2.5, material: undefined });
      trail.material.uniforms.color = Color.fromCssColorString('#FFB020').withAlpha(0.75);
    }
    trail.positions = [...trailPositions, entry.position];
  }

  function clearSelectedTrack() {
    trailPositions = [];
    if (trail) trailCollection.remove(trail);
    if (lastFix) lastFixCollection.remove(lastFix);
    trail = null;
    lastFix = null;
  }

  function updateModel(entry) {
    if (!model || modelFailed || !model.ready) return;
    if (!entry) {
      model.show = false;
      return;
    }
    model.show = modelVisible && (showGround || !entry.data.onGround || entry.id === selectedId);
    // En glTF 2.0 converti par CesiumJS, heading = 0 oriente déjà +X (le nez du modèle) vers le nord.
    scratchHpr.heading = CesiumMath.toRadians(entry.display.headingDeg ?? 0);
    scratchHpr.pitch = 0;
    scratchHpr.roll = 0;
    Transforms.headingPitchRollToFixedFrame(entry.position, scratchHpr, Ellipsoid.WGS84, undefined, model.modelMatrix);
    model.color = entry.missing ? Color.WHITE.withAlpha(0.5) : Color.WHITE;
  }

  function updateSingleEntryPosition(entry, nowMs) {
    if (!entry?.data) return;
    entry.display = computeDisplay(entry, nowMs);
    const { lon, lat, altitudeM, headingDeg } = entry.display;
    Cartesian3.fromDegrees(lon, lat, entry.data.onGround ? 0 : altitudeM, Ellipsoid.WGS84, entry.position);
    if (entry.billboard.show) {
      entry.billboard.position = entry.position;
      entry.billboard.alignedAxis = localNorth(entry.position, scratchNorth);
      entry.billboard.rotation = headingDeg === null ? 0 : -CesiumMath.toRadians(headingDeg);
    }
    if (entry.label.show) entry.label.position = entry.position;
  }

  return {
    /**
     * Synchronise l'affichage avec la liste d'avions du store.
     * @param {Map<string, {data: object, missing: boolean}>} flights
     */
    sync(flights, nowMs = Date.now()) {
      for (const entry of [...entries.values()]) {
        if (!flights.has(entry.id)) removeEntry(entry);
      }
      // Limite du nombre de marqueurs (adaptée aux smartphones) : l'avion sélectionné est toujours gardé.
      let budget = lowPower ? SETTINGS.flights.maxMarkersMobile : SETTINGS.flights.maxMarkers;
      for (const [id, flight] of flights) {
        if (budget <= 0 && id !== selectedId) {
          if (entries.has(id)) removeEntry(entries.get(id));
          continue;
        }
        budget -= 1;
        let entry = entries.get(id);
        if (!entry) {
          entry = createEntry(flight.data);
          entries.set(id, entry);
        }
        applyData(entry, flight.data, flight.missing, nowMs);
        updateEntryVisual(entry);
        if (id === selectedId) updateSelectedTrack(entry, true);
      }
      needsFullUpdate = true;
    },

    /** Mise à jour des positions, optimisée pour 60 FPS en suivi et faible consommation en vue globale. */
    update(nowMs = Date.now()) {
      const selected = selectedId ? entries.get(selectedId) : null;

      // Si un avion est suivi, lui seul est visible : on le met à jour à chaque image (60 FPS)
      // sans recalculer inutilement les centaines d'autres appareils masqués.
      if (selected && !needsFullUpdate) {
        updateSingleEntryPosition(selected, nowMs);
        updateModel(selected);
        if (trail) updateSelectedTrack(selected, false);
        return;
      }

      // En vue globale, on espace le recalcul massif des marqueurs (200 ms PC / 450 ms mobile)
      // pour préserver le processeur et la batterie du téléphone.
      const bulkIntervalMs = lowPower ? 450 : 200;
      if (needsFullUpdate || nowMs - lastBulkUpdateMs >= bulkIntervalMs) {
        lastBulkUpdateMs = nowMs;
        needsFullUpdate = false;
        for (const entry of entries.values()) {
          updateSingleEntryPosition(entry, nowMs);
        }
      } else if (selected) {
        updateSingleEntryPosition(selected, nowMs);
      }

      updateModel(selected);
      if (selected && trail) updateSelectedTrack(selected, false);
    },

    setSelected(id) {
      if (id === selectedId) return;
      selectedId = id;
      needsFullUpdate = true;
      clearSelectedTrack();
      entries.forEach(updateEntryVisual);
      const current = entries.get(id);
      if (current) {
        updateSelectedTrack(current, true);
      }
      if (!current && model) model.show = false;
    },

    /** État affiché d'un avion (utilisé par la caméra). */
    getDisplayState(id) {
      const entry = entries.get(id);
      if (!entry?.display) return null;
      return { ...entry.display, position: entry.position, missing: entry.missing, data: entry.data };
    },

    setLabelsVisible(value) {
      showLabels = value;
      needsFullUpdate = true;
      entries.forEach(updateEntryVisual);
    },

    setShowGround(value) {
      showGround = value;
      needsFullUpdate = true;
      entries.forEach(updateEntryVisual);
    },

    /** Masque le modèle (vue cockpit : la caméra est "dans" l'avion). */
    setModelVisible(value) {
      modelVisible = value;
      needsFullUpdate = true;
      entries.forEach(updateEntryVisual);
    },

    get modelAvailable() {
      return Boolean(model && model.ready && !modelFailed);
    },

    get count() {
      return entries.size;
    },

    destroy() {
      for (const primitive of [billboards, labels, trailCollection, lastFixCollection, model]) {
        if (primitive) scene.primitives.remove(primitive);
      }
      entries.clear();
    },
  };
}

/** Identifiant d'avion sous un point de l'écran, ou null. */
export function pickAircraftId(scene, screenPosition) {
  const picked = scene.pick(screenPosition);
  if (picked && typeof picked.id === 'string') return picked.id;
  return null;
}

export { Matrix4 };

