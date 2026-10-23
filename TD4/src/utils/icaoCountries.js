/**
 * Pays d'immatriculation déduit de l'adresse OACI 24 bits (code "hex").
 *
 * L'OACI attribue à chaque État un bloc d'adresses (Annexe 10, vol. III).
 * Ce tableau reprend les principaux blocs ; un code hors tableau renvoie `null`
 * et l'interface affiche alors « Non disponible ».
 * Il s'agit du pays d'immatriculation de l'appareil, pas de la compagnie.
 */
const ICAO_BLOCKS = [
  [0x008000, 0x00ffff, 'Afrique du Sud'],
  [0x010000, 0x017fff, 'Égypte'],
  [0x020000, 0x027fff, 'Maroc'],
  [0x028000, 0x02ffff, 'Libye'],
  [0x06a000, 0x06a3ff, 'Qatar'],
  [0x0a0000, 0x0a7fff, 'Algérie'],
  [0x0d0000, 0x0d7fff, 'Mexique'],
  [0x100000, 0x1fffff, 'Russie'],
  [0x300000, 0x33ffff, 'Italie'],
  [0x340000, 0x37ffff, 'Espagne'],
  [0x380000, 0x3bffff, 'France'],
  [0x3c0000, 0x3fffff, 'Allemagne'],
  [0x400000, 0x43ffff, 'Royaume-Uni'],
  [0x440000, 0x447fff, 'Autriche'],
  [0x448000, 0x44ffff, 'Belgique'],
  [0x450000, 0x457fff, 'Bulgarie'],
  [0x458000, 0x45ffff, 'Danemark'],
  [0x460000, 0x467fff, 'Finlande'],
  [0x468000, 0x46ffff, 'Grèce'],
  [0x470000, 0x477fff, 'Hongrie'],
  [0x478000, 0x47ffff, 'Norvège'],
  [0x480000, 0x487fff, 'Pays-Bas'],
  [0x488000, 0x48ffff, 'Pologne'],
  [0x490000, 0x497fff, 'Portugal'],
  [0x498000, 0x49ffff, 'Tchéquie'],
  [0x4a0000, 0x4a7fff, 'Roumanie'],
  [0x4a8000, 0x4affff, 'Suède'],
  [0x4b0000, 0x4b7fff, 'Suisse'],
  [0x4b8000, 0x4bffff, 'Turquie'],
  [0x4c0000, 0x4c7fff, 'Serbie'],
  [0x4c8000, 0x4c83ff, 'Chypre'],
  [0x4ca000, 0x4cafff, 'Irlande'],
  [0x4cc000, 0x4ccfff, 'Islande'],
  [0x4d0000, 0x4d03ff, 'Luxembourg'],
  [0x4d2000, 0x4d23ff, 'Malte'],
  [0x4d4000, 0x4d43ff, 'Monaco'],
  [0x501c00, 0x501fff, 'Croatie'],
  [0x502c00, 0x502fff, 'Lettonie'],
  [0x503c00, 0x503fff, 'Lituanie'],
  [0x505c00, 0x505fff, 'Slovaquie'],
  [0x506c00, 0x506fff, 'Slovénie'],
  [0x508000, 0x50ffff, 'Ukraine'],
  [0x511000, 0x5113ff, 'Estonie'],
  [0x710000, 0x717fff, 'Arabie saoudite'],
  [0x718000, 0x71ffff, 'Corée du Sud'],
  [0x738000, 0x73ffff, 'Israël'],
  [0x750000, 0x757fff, 'Malaisie'],
  [0x758000, 0x75ffff, 'Philippines'],
  [0x760000, 0x767fff, 'Pakistan'],
  [0x768000, 0x76ffff, 'Singapour'],
  [0x780000, 0x7bffff, 'Chine'],
  [0x7c0000, 0x7fffff, 'Australie'],
  [0x800000, 0x83ffff, 'Inde'],
  [0x840000, 0x87ffff, 'Japon'],
  [0x880000, 0x887fff, 'Thaïlande'],
  [0x888000, 0x88ffff, 'Viêt Nam'],
  [0x896000, 0x896fff, 'Émirats arabes unis'],
  [0x8a0000, 0x8a7fff, 'Indonésie'],
  [0xa00000, 0xafffff, 'États-Unis'],
  [0xc00000, 0xc3ffff, 'Canada'],
  [0xc80000, 0xc87fff, 'Nouvelle-Zélande'],
  [0xe00000, 0xe3ffff, 'Argentine'],
  [0xe40000, 0xe7ffff, 'Brésil'],
  [0xe80000, 0xe80fff, 'Chili'],
];

export function countryFromIcaoHex(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex, 16);
  const block = ICAO_BLOCKS.find(([start, end]) => value >= start && value <= end);
  return block ? block[2] : null;
}

