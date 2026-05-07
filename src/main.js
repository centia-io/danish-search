/*
 * @author     Martin Høgh
 * @copyright  2013-2026 MapCentia ApS
 * @license    MIT (see LICENSE file in the project root)
 */

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
