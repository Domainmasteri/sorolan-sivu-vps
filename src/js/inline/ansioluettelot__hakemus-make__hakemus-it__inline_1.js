// Asetetaan nykyinen päivämäärä
    const dateElement = document.getElementById('current-date');
    const today = new Date();
    dateElement.textContent = today.toLocaleDateString('fi-FI');
