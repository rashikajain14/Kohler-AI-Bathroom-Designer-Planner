/* ---- boot.js ---- */

/* =================== HERO ART =================== */
document.getElementById('heroArt').insertAdjacentHTML('afterbegin', scene(AES.modern.pal, 0));

/* =================== BOOT =================== */
bootPlanner();
paintHero();
route();
observeAll();
platformInit();
