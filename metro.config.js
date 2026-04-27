// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Tell Metro these are *assets* (so `require()` works)
config.resolver.assetExts.push("pte", "tok", "tokcfg");

module.exports = config;