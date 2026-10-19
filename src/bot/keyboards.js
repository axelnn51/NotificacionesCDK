const { Markup } = require('telegraf');

/**
 * Menú persistente inferior para fácil acceso en móvil
 */
function getMainMenu() {
  return Markup.keyboard([
    ['🛍️ Últimos Pedidos', '💻 Estado de mi PC'],
    ['🔄 Sincronizar Ahora', 'ℹ️ Ayuda']
  ]).resize();
}

/**
 * Teclado inline interactivo para el panel de estado de la PC
 */
function getPcKeyboard(isOnline) {
  if (isOnline) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🔄 Actualizar Estado', 'pc_refresh'),
        Markup.button.callback('🛑 Apagar PC', 'pc_prompt_shutdown')
      ]
    ]);
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔄 Comprobar de nuevo', 'pc_refresh')
    ]
  ]);
}

/**
 * Teclado inline de confirmación para evitar apagados accidentales
 */
function getShutdownConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⚠️ Sí, Apagar PC Ahora', 'pc_confirm_shutdown'),
      Markup.button.callback('❌ Cancelar', 'pc_cancel_shutdown')
    ]
  ]);
}

module.exports = {
  getMainMenu,
  getPcKeyboard,
  getShutdownConfirmKeyboard
};
