const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'pedidos.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    direccion TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    items TEXT NOT NULL,
    direccion_entrega TEXT NOT NULL,
    total INTEGER NOT NULL,
    estado TEXT NOT NULL DEFAULT 'nuevo',
    metodo_pago TEXT NOT NULL DEFAULT 'efectivo',
    monto_pagado INTEGER,
    vuelto INTEGER,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migraciones seguras para bases de datos creadas con versiones anteriores del esquema.
const columnasPedidos = db.prepare('PRAGMA table_info(pedidos)').all().map((c) => c.name);
for (const [columna, definicion] of [
  ['metodo_pago', "TEXT NOT NULL DEFAULT 'efectivo'"],
  ['monto_pagado', 'INTEGER'],
  ['vuelto', 'INTEGER']
]) {
  if (!columnasPedidos.includes(columna)) {
    db.exec(`ALTER TABLE pedidos ADD COLUMN ${columna} ${definicion}`);
  }
}
for (const columna of ['subtotal', 'descuento_aplicado']) {
  if (columnasPedidos.includes(columna)) {
    db.exec(`ALTER TABLE pedidos DROP COLUMN ${columna}`);
  }
}

const columnasClientes = db.prepare('PRAGMA table_info(clientes)').all().map((c) => c.name);
if (columnasClientes.includes('pedidos_total')) {
  db.exec('ALTER TABLE clientes DROP COLUMN pedidos_total');
}

module.exports = db;
