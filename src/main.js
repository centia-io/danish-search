import './style.css'
import danish from "./danish.js"



document.querySelector('#app').innerHTML = `
<div id="place-search">
    <div class="places d-flex">
        <div class="input-group mb-3">
            <input class="custom-search typeahead form-control" type="text"
                   placeholder="Søg">
            <button class="btn btn-outline-secondary searchclear" type="button">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>
    </div>
</div>
`



    danish();


