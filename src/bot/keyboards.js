const { Markup } = require('telegraf');

/**
 * Menú persistente inferior para control remoto desde móvil
 */
function getMainMenu() {
  return Markup.keyboard([
    ['📸 Ver Pantalla', '💻 Estado de mi PC'],
    ['🛑 Apagar PC', 'ℹ️ Ayuda']
  ]).resize();
}

/**
 * Teclado inline interactivo para el panel de estado de la PC
 */
function getPcKeyboard(isOnline) {
  if (isOnline) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('📸 Capturar Pantalla', 'pc_screenshot'),
        Markup.button.callback('🔄 Actualizar', 'pc_refresh')
      ],
      [
        Markup.button.callback('🛑 Apagar PC', 'pc_prompt_shutdown')
      ]
    ]);
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔄 Comprobar Conexión', 'pc_refresh')
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

/**
 * Teclado interactivo para seleccionar pantallas individuales o vista completa
 */
function getScreenSelectKeyboard(screens = []) {
  const rows = [];
  
  if (Array.isArray(screens) && screens.length > 1) {
    const screenButtons = screens.map(s => 
      Markup.button.callback(`🖥️ P${s.index} (${s.resolution})`, `pc_shot_${s.index}`)
    );
    rows.push(screenButtons);
  } else {
    rows.push([
      Markup.button.callback('🖥️ Pantalla 1', 'pc_shot_1'),
      Markup.button.callback('🖥️ Pantalla 2', 'pc_shot_2'),
      Markup.button.callback('🖥️ Pantalla 3', 'pc_shot_3')
    ]);
  }

  rows.push([
    Markup.button.callback('🌐 Panorámica Total', 'pc_shot_pano'),
    Markup.button.callback('🔄 Capturar Todas', 'pc_shot_all')
  ]);

  return Markup.inlineKeyboard(rows);
}

module.exports = {
  getMainMenu,
  getPcKeyboard,
  getShutdownConfirmKeyboard,
  getScreenSelectKeyboard
};
