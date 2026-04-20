const {
  getParqueaderoConfig,
  saveParqueaderoConfig,
} = require('../../../utils/parqueadero-config');

async function getConfig(empresaId) {
  return getParqueaderoConfig(empresaId);
}

async function updateConfig(empresaId, body) {
  return saveParqueaderoConfig(empresaId, body);
}

module.exports = { getConfig, updateConfig };
