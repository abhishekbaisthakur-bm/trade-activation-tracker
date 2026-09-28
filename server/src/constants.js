const ASSETS = [
  { key: "poster", label: "Poster", mode: "installed" },
  { key: "wobbler", label: "Wobbler", mode: "installed" },
  { key: "dangler", label: "Dangler", mode: "installed" },
  { key: "shelf_strip", label: "Shelf Strip", mode: "installed" },
  { key: "gravity_feeder", label: "Gravity Feeder", mode: "installed" },
  { key: "shelf_in_shelf", label: "Shelf-in-Shelf", mode: "installed" },
  { key: "brown_envelope", label: "Brown Envelope", mode: "distributed" },
];
const ASSET_KEYS = ASSETS.map((a) => a.key);
const ASSET_LABEL = Object.fromEntries(ASSETS.map((a) => [a.key, a.label]));
const LABEL_TO_KEY = Object.fromEntries(ASSETS.map((a) => [a.label.toLowerCase(), a.key]));
const STATUSES = ["Submitted", "Pending Review", "Approved", "Rejected"];
const shopKeyOf = (city, name) => `${String(city).trim().toLowerCase()}|${String(name).trim().toLowerCase().replace(/\s+/g, " ")}`;

module.exports = { ASSETS, ASSET_KEYS, ASSET_LABEL, LABEL_TO_KEY, STATUSES, shopKeyOf };
