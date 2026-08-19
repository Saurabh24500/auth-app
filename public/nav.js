function mountTopNav() {
  const nav = document.createElement('header');
  nav.className = 'topnav';
  nav.innerHTML = `
    <a class="brand" href="/">Auth App</a>
    <nav class="navlinks" id="navlinks"></nav>
  `;
  document.body.prepend(nav);
  document.body.classList.add('has-topnav');

  const links = document.getElementById('navlinks');

  function render(authed) {
    if (authed) {
      links.innerHTML = `
        <a href="/dashboard">Dashboard</a>
        <a href="#" id="logoutLink">Log out</a>`;
      document.getElementById('logoutLink').addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
      });
    } else {
      const path = location.pathname;
      links.innerHTML = `
        <a href="/login" class="${path === '/login' ? 'active' : ''}">Log in</a>
        <a href="/register" class="${path === '/register' ? 'active' : ''}" class="btn-nav">Sign up</a>`;
    }
  }

  fetch('/api/me')
    .then((r) => r.json())
    .then((d) => render(!!d.ok))
    .catch(() => render(false));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountTopNav);
} else {
  mountTopNav();
}
