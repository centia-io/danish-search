export default class Autocomplete {
    constructor(input, options, ...datasets) {
        this.input = typeof input === 'string' ? document.querySelector(input) : input;
        this.datasets = datasets;
        this.options = options;
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'tt-dropdown-menu';
        this.dropdown.style.display = 'none';
        this.input.parentNode.insertBefore(this.dropdown, this.input.nextSibling);
        this.input.setAttribute('autocomplete', 'off');

        this.selectedIndex = -1;

        this.input.addEventListener('input', () => {
            const query = this.input.value;
            this.selectedIndex = -1;
            if (query.length < (options.minLength || 1)) {
                this.hide();
                return;
            }
            this.search(query);
        });

        this.input.addEventListener('keydown', (e) => {
            const suggestions = this.dropdown.querySelectorAll('.tt-suggestion');
            if (e.key === 'ArrowDown') {
                this.selectedIndex = Math.min(this.selectedIndex + 1, suggestions.length - 1);
                this.updateSelection(suggestions);
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
                this.updateSelection(suggestions);
                e.preventDefault();
            } else if (e.key === 'Enter') {
                if (this.selectedIndex >= 0) {
                    suggestions[this.selectedIndex].click();
                    e.preventDefault();
                }
            } else if (e.key === 'Escape') {
                this.hide();
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.input.contains(e.target) && !this.dropdown.contains(e.target)) {
                this.hide();
            }
        });
    }

    updateSelection(suggestions) {
        suggestions.forEach((s, i) => {
            if (i === this.selectedIndex) {
                s.classList.add('tt-cursor');
                s.scrollIntoView({ block: 'nearest' });
            } else {
                s.classList.remove('tt-cursor');
            }
        });
    }

    search(query) {
        this.dropdown.innerHTML = '';
        this.datasets.forEach(dataset => {
            dataset.source(query, (results) => {
                if (results && results.length > 0) {
                    this.renderDataset(dataset, results, query);
                }
                if (this.dropdown.children.length > 0) {
                    this.show();
                } else {
                    this.hide();
                }
            });
        });
    }

    renderDataset(dataset, results, query) {
        if (dataset.templates && dataset.templates.header) {
            const header = document.createElement('div');
            header.innerHTML = typeof dataset.templates.header === 'function'
                ? dataset.templates.header({query, isEmpty: false})
                : dataset.templates.header;
            this.dropdown.appendChild(header);
        }

        const suggestionsContainer = document.createElement('div');
        suggestionsContainer.className = 'tt-suggestions';
        results.forEach(result => {
            const suggestion = document.createElement('div');
            suggestion.className = 'tt-suggestion';
            const displayValue = dataset.displayKey ? result[dataset.displayKey] : result;
            suggestion.innerHTML = dataset.templates && dataset.templates.suggestion
                ? dataset.templates.suggestion(result)
                : `<p>${displayValue}</p>`;

            suggestion.addEventListener('click', () => {
                this.input.value = displayValue;
                this.hide();
                const event = new CustomEvent('typeahead:selected', {
                    detail: { datum: result, name: dataset.name }
                });
                this.input.dispatchEvent(event);
            });
            suggestionsContainer.appendChild(suggestion);
        });
        this.dropdown.appendChild(suggestionsContainer);
    }

    show() {
        this.dropdown.style.display = 'block';
    }

    hide() {
        this.dropdown.style.display = 'none';
    }

    val(newVal) {
        if (arguments.length === 0) {
            return this.input.value;
        }
        this.input.value = newVal;
    }
}
