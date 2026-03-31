import './style.css'
import danish from "./danish.js"

document.querySelector('#app').innerHTML = `
<div id="place-search">
    <div class="search-container">
        <input class="custom-search" type="text" placeholder="Søg adresse eller matrikel...">
        <button class="searchclear" type="button">&times;</button>
    </div>
    <div id="search-result"></div>
</div>
`

const inputEl = danish({
    onSelect({type, gid, value, searchType, feature}) {
        document.getElementById('search-result').innerHTML =
            `<div class="result-item">
                <strong>${type === 'adresse' ? 'Adresse' : 'Matrikel'}:</strong> ${value}<br>
                <small>GID: ${gid}</small>
            </div>`;
    }
});

document.querySelector('.searchclear').addEventListener('click', () => {
    inputEl.value = '';
    document.getElementById('search-result').innerHTML = '';
    inputEl.focus();
});
