const express = require('express');
const ExcelJS = require('exceljs');
const db = require('./db');
const config = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(__dirname + '/public'));

const PRODUCTOS_POR_ID = Object.fromEntries(config.productos.map((p) => [p.id, p]));

function clasificarProductos(filasItems) {
  const acumulado = {};
  for (const fila of filasItems) {
    for (const item of JSON.parse(fila.items)) {
      if (!acumulado[item.productoId]) {
        acumulado[item.productoId] = {
          productoId: item.productoId,
          nombre: item.nombre,
          cantidad: 0,
          cantidadConAdicional: 0,
          total: 0,
          totalAdicionales: 0
        };
      }
      const extra = item.extraCarne ? config.extras.extraCarne.precio * item.cantidad : 0;
      const acumuladoFila = acumulado[item.productoId];
      acumuladoFila.cantidad += item.cantidad;
      acumuladoFila.total += item.precio * item.cantidad + extra;
      if (item.extraCarne) {
        acumuladoFila.cantidadConAdicional += item.cantidad;
        acumuladoFila.totalAdicionales += extra;
      }
    }
  }
  return Object.values(acumulado).sort((a, b) => b.cantidad - a.cantidad);
}

const TRANSICIONES = {
  nuevo: 'cocina_lista',
  cocina_lista: 'despachado',
  despachado: 'entregado'
};

const ESTADOS_LEGIBLES = {
  nuevo: 'En cocina',
  cocina_lista: 'En despacho',
  despachado: 'En camino',
  entregado: 'Entregado'
};

function mapaPedido(row) {
  return {
    id: row.id,
    items: JSON.parse(row.items),
    direccionEntrega: row.direccion_entrega,
    total: row.total,
    estado: row.estado,
    estadoLegible: ESTADOS_LEGIBLES[row.estado] || row.estado,
    metodoPago: row.metodo_pago,
    montoPagado: row.monto_pagado,
    vuelto: row.vuelto,
    creadoEn: row.creado_en,
    cliente: {
      id: row.cliente_id,
      nombre: row.cliente_nombre,
      telefono: row.cliente_telefono
    }
  };
}

// ---- Config pública (menú, negocio) ----
app.get('/api/config', (req, res) => {
  res.json({
    negocio: config.negocio,
    productos: config.productos,
    extras: config.extras
  });
});

// ---- Acceso por PIN a cada panel ----
app.post('/api/login', (req, res) => {
  const { rol, pin } = req.body || {};
  if (config.pins[rol] && config.pins[rol] === pin) {
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

// ---- Crear pedido (formulario del cliente) ----
app.post('/api/pedidos', (req, res) => {
  const { nombre, telefono, direccion, items, metodoPago, montoPagado } = req.body || {};

  if (!nombre || !telefono || !direccion || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos del pedido.' });
  }

  const pagoEsEfectivo = metodoPago !== 'transferencia';
  let montoPagadoNumero = null;
  if (pagoEsEfectivo) {
    montoPagadoNumero = Number(montoPagado);
    if (!Number.isFinite(montoPagadoNumero) || montoPagadoNumero <= 0) {
      return res.status(400).json({ error: 'Indica con cuánto vas a pagar en efectivo.' });
    }
  }

  let total = 0;
  const itemsLimpios = [];
  for (const item of items) {
    const producto = PRODUCTOS_POR_ID[item.productoId];
    const cantidad = Number(item.cantidad);
    if (!producto || !Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Producto o cantidad inválida.' });
    }
    const extraCarne = !!item.extraCarne;
    const sinLechuga = !!item.sinLechuga;
    const sinSalsa = !!item.sinSalsa;
    const notas = typeof item.notas === 'string' ? item.notas.trim().slice(0, 200) : '';

    total += producto.precio * cantidad + (extraCarne ? config.extras.extraCarne.precio * cantidad : 0);
    itemsLimpios.push({
      productoId: producto.id,
      nombre: producto.nombre,
      cantidad,
      precio: producto.precio,
      extraCarne,
      sinLechuga,
      sinSalsa,
      notas
    });
  }

  if (pagoEsEfectivo && montoPagadoNumero < total) {
    return res.status(400).json({ error: 'El monto pagado es menor al total del pedido.' });
  }
  const vuelto = pagoEsEfectivo ? montoPagadoNumero - total : null;

  let cliente = db.prepare('SELECT * FROM clientes WHERE telefono = ?').get(telefono);
  if (!cliente) {
    const info = db
      .prepare('INSERT INTO clientes (telefono, nombre, direccion) VALUES (?, ?, ?)')
      .run(telefono, nombre, direccion);
    cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid);
  } else {
    db.prepare('UPDATE clientes SET nombre = ?, direccion = ? WHERE id = ?').run(nombre, direccion, cliente.id);
  }

  const infoPedido = db
    .prepare(
      `INSERT INTO pedidos (cliente_id, items, direccion_entrega, total, metodo_pago, monto_pagado, vuelto)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cliente.id,
      JSON.stringify(itemsLimpios),
      direccion,
      total,
      pagoEsEfectivo ? 'efectivo' : 'transferencia',
      montoPagadoNumero,
      vuelto
    );

  const pedidoId = Number(infoPedido.lastInsertRowid);

  const lineas = itemsLimpios
    .map((i) => {
      const mods = [];
      if (i.extraCarne) mods.push('extra carne');
      if (i.sinLechuga) mods.push('sin lechuga');
      if (i.sinSalsa) mods.push('sin salsa');
      let linea = `- ${i.nombre} x${i.cantidad}`;
      if (mods.length) linea += ` (${mods.join(', ')})`;
      if (i.notas) linea += ` — ${i.notas}`;
      return linea;
    })
    .join('\n');

  const lineaPago = pagoEsEfectivo
    ? `Pago: Efectivo, paga con $${montoPagadoNumero.toLocaleString('es-CO')} (vuelto $${vuelto.toLocaleString('es-CO')})`
    : 'Pago: Transferencia';

  const mensaje =
    `Pedido #${pedidoId} - ${config.negocio.nombre}\n` +
    `Cliente: ${nombre}\n` +
    `Tel: ${telefono}\n` +
    `Dirección: ${direccion}\n` +
    `${lineas}\n` +
    `${lineaPago}\n` +
    `Total: $${total.toLocaleString('es-CO')}`;

  const enlaceWhatsapp = `https://wa.me/${config.negocio.telefonoWhatsapp}?text=${encodeURIComponent(mensaje)}`;

  res.status(201).json({ pedidoId, total, vuelto, enlaceWhatsapp });
});

// ---- Listar pedidos por estado (paneles de cocina/despacho/domiciliario) ----
app.get('/api/pedidos', (req, res) => {
  const { estado } = req.query;
  if (!estado) return res.status(400).json({ error: 'Falta el parámetro estado.' });

  const rows = db
    .prepare(
      `SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado = ?
       ORDER BY p.id ASC`
    )
    .all(estado);

  res.json(rows.map(mapaPedido));
});

// ---- Avanzar el estado de un pedido ----
app.patch('/api/pedidos/:id/avanzar', (req, res) => {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

  const siguienteEstado = TRANSICIONES[pedido.estado];
  if (!siguienteEstado) {
    return res.status(400).json({ error: 'Este pedido ya está en su último estado.' });
  }

  db.prepare("UPDATE pedidos SET estado = ?, actualizado_en = datetime('now') WHERE id = ?").run(
    siguienteEstado,
    pedido.id
  );

  res.json({ id: pedido.id, estado: siguienteEstado });
});

// ---- Estado de un pedido (para que el cliente lo siga, sin datos sensibles) ----
app.get('/api/pedidos/:id/estado', (req, res) => {
  const pedido = db.prepare('SELECT id, estado FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });
  res.json({ id: pedido.id, estado: pedido.estado, estadoLegible: ESTADOS_LEGIBLES[pedido.estado] || pedido.estado });
});

// ---- Venta de un día, semana, mes o año específico (solo pedidos entregados) ----
app.get('/api/dashboard/venta', (req, res) => {
  const { periodo, valor } = req.query;
  const columnas = {
    dia: "date(creado_en) = ?",
    semana: "strftime('%Y-W%W', creado_en) = ?",
    mes: "strftime('%Y-%m', creado_en) = ?",
    anio: "strftime('%Y', creado_en) = ?"
  };
  if (!columnas[periodo] || !valor) {
    return res.status(400).json({ error: 'Indica un periodo (dia, semana, mes, anio) y un valor.' });
  }

  const fila = db
    .prepare(
      `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS total
       FROM pedidos
       WHERE estado = 'entregado' AND ${columnas[periodo]}`
    )
    .get(valor);

  const pedidosPeriodo = db
    .prepare(
      `SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
       WHERE ${columnas[periodo].replace('creado_en', 'p.creado_en')}
       ORDER BY p.id DESC`
    )
    .all(valor)
    .map(mapaPedido);

  const itemsEntregados = db
    .prepare(`SELECT items FROM pedidos WHERE estado = 'entregado' AND ${columnas[periodo]}`)
    .all(valor);
  const productosPeriodo = clasificarProductos(itemsEntregados);

  // Cada venta individual (una fila por producto vendido en cada pedido ya entregado).
  const ventasIndividuales = [];
  for (const pedido of pedidosPeriodo) {
    if (pedido.estado !== 'entregado') continue;
    for (const item of pedido.items) {
      const extra = item.extraCarne ? config.extras.extraCarne.precio * item.cantidad : 0;
      ventasIndividuales.push({
        pedidoId: pedido.id,
        hora: pedido.creadoEn.slice(11, 16),
        comprador: pedido.cliente.nombre,
        producto: item.nombre + (item.extraCarne ? ' (extra carne)' : ''),
        cantidad: item.cantidad,
        total: item.precio * item.cantidad + extra
      });
    }
  }

  res.json({ periodo, valor, pedidos: fila.pedidos, total: fila.total, pedidosPeriodo, productosPeriodo, ventasIndividuales });
});

// ---- Exportar todas las ventas finalizadas a Excel ----
app.get('/api/dashboard/exportar', async (req, res) => {
  const pedidos = db
    .prepare(
      `SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado = 'entregado'
       ORDER BY p.creado_en ASC`
    )
    .all();

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Ventas');
  hoja.columns = [
    { header: 'Fecha', key: 'fecha', width: 18 },
    { header: 'Producto', key: 'producto', width: 28 },
    { header: 'Comprador', key: 'comprador', width: 22 },
    { header: 'Teléfono', key: 'telefono', width: 16 },
    { header: 'Cantidad', key: 'cantidad', width: 10 },
    { header: 'Total ($)', key: 'totalLinea', width: 14 }
  ];
  hoja.getRow(1).font = { bold: true };

  for (const pedido of pedidos) {
    for (const item of JSON.parse(pedido.items)) {
      const extra = item.extraCarne ? config.extras.extraCarne.precio * item.cantidad : 0;
      hoja.addRow({
        fecha: pedido.creado_en,
        producto: item.nombre + (item.extraCarne ? ' (extra carne)' : ''),
        comprador: pedido.cliente_nombre,
        telefono: pedido.cliente_telefono,
        cantidad: item.cantidad,
        totalLinea: item.precio * item.cantidad + extra
      });
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ventas-jj-first-class.xlsx"');
  await libro.xlsx.write(res);
  res.end();
});

// ---- Dashboard para el manager / CEO (productos más vendidos, histórico global) ----
app.get('/api/dashboard', (req, res) => {
  const todosLosItems = db.prepare("SELECT items FROM pedidos WHERE estado = 'entregado'").all();
  const productosMasVendidos = clasificarProductos(todosLosItems);
  res.json({ productosMasVendidos });
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
  console.log(`JJ First Class - sistema de pedidos escuchando en http://localhost:${PUERTO}`);
});
