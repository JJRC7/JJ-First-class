function protegerPagina(rol) {
  return new Promise((resolve) => {
    const yaEntro = sessionStorage.getItem('pin_' + rol) === 'ok';
    const gate = document.getElementById('pin-gate');
    const contenido = document.getElementById('contenido');

    if (yaEntro) {
      gate.style.display = 'none';
      contenido.style.display = 'block';
      resolve();
      return;
    }

    gate.style.display = 'block';
    contenido.style.display = 'none';

    const form = gate.querySelector('form');
    const input = gate.querySelector('input');
    const error = gate.querySelector('.error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rol, pin: input.value })
      });
      if (r.ok) {
        sessionStorage.setItem('pin_' + rol, 'ok');
        gate.style.display = 'none';
        contenido.style.display = 'block';
        resolve();
      } else {
        error.textContent = 'PIN incorrecto.';
        input.value = '';
        input.focus();
      }
    });
  });
}
