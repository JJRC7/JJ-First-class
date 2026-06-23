// Datos reales del negocio. Edita aquí si cambian precios, dirección o PINs.
module.exports = {
  negocio: {
    nombre: 'JJ First Class',
    direccion: 'Calle 5 #10-21, Sabanagrande, Atlántico, Colombia',
    telefonoWhatsapp: '573053837662' // 57 = Colombia + número sin espacios
  },
  productos: [
    { id: 'american_burger', nombre: 'Combo American Burger', descripcion: 'Incluye gaseosa y papas', precio: 22000, imagen: 'assets/galeria-2.png' },
    { id: 'sabor_costeno', nombre: 'Combo Sabor Costeño', descripcion: 'Incluye gaseosa y papas', precio: 22000, imagen: 'assets/galeria-4.png' }
  ],
  extras: {
    extraCarne: { nombre: 'Extra carne', precio: 3000 }
  },
  // PINs de acceso a cada panel. Cámbialos cuando quieras, son solo para que
  // nadie externo entre por error si comparten el link.
  pins: {
    cocina: '1111',
    despacho: '2222',
    domiciliario: '3333',
    manager: '0427'
  }
};
