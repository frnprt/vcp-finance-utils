// ==UserScript==
// @name        VCP Finance Utils
// @namespace   https://github.com/frnprt/vcp-autocalculator
// @description Automatically computes monthly gains from VCP site
// @match       http://www.principatumpapiae.com/scheda_euro.php
// @version     1.0.5.3
// @updateURL   https://raw.githubusercontent.com/frnprt/vcp-autocalculator/main/vcp-autocalculate.js
// @downloadURL https://raw.githubusercontent.com/frnprt/vcp-autocalculator/main/vcp-autocalculate.js
// @author      frnprt
// @grant       none
// @require     https://code.jquery.com/jquery-3.7.1.min.js#sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=
// @require     https://cdn.jsdelivr.net/npm/table-to-json@1.0.0/lib/jquery.tabletojson.min.js#sha256-H8xrCe0tZFi/C2CgxkmiGksqVaxhW0PFcUKZJZo1yNU=
// @require     https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js#sha256-qXBd/EfAdjOA2FGrGAG+b3YBn2tn5A6bhz+LSgYD96k=
// @require     https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js#sha256-EVZCmhajjLhgTcxlGMGUBtQiYULZCPjt0uNTFEPFTRk=
// ==/UserScript==

(function() {
    'use strict';

    // Constants:
    // Substrings to use to identify influences actions;
    // "Strada-" and "Finanza-" have the "-" suffix to differentiate them from the
    // omonimous income from skills.
    const INFLUENCES_DESCRIPTORS = [
        "Trasporti", "Finanza-", "Giustizia", "Polizia", "Occulto",
        "Burocrazia", "Malavita", "Politica", "Media", "Industria",
        "Strada-", "Università", "Alta Società"
    ];

    const PASSIVE_DESCRIPTORS = ["Passiva"];

    // Initialization:
    // Map containing the numbers of the months (namely, digit that is the suffix in their "header_mesi" DOM element) as keys
    // and their common name as value. The same order of the displayed HTML page (top to bottom) is preserved.
    const MONTHS_MAP = initializeMonthsMap();

    /**
     * Initializes the MONTHS_MAP by parsing the "header_mesi" headers.
     * @returns {Map} A map with month numbers as keys and month names as values.
     */
    function initializeMonthsMap() {
        const months = document.querySelectorAll("tr[id^=header_mesi]");
        const monthsMap = new Map();
        months.forEach(element => {
            const monthNumber = element.id.trim().replace(/^\D+/g, '');
            const monthName = element.innerText.trim();
            monthsMap.set(monthNumber, monthName);
        });
        return monthsMap;
    }

    /**
     * Parses the financial movements of a given month.
     * @param {number} monthNumber - The number of the month.
     * @returns {Object[]} An array of financial movement objects for the month.
     */
    function parseMonth(monthNumber) {
        // Create a JSON object from the table of the financial movements of the month
        // Month number is increased by 1 to take in account the off-by-one enumeration of money movements tables in the HTML code
        // example: if December 2023 has an "header_mesi_0" header, its movements table will be marked as "movimenti_1"
        const table = $(`#movimenti_${parseInt(monthNumber) + 1}`).tableToJSON({
            headings: ['', 'data_operazione', 'entrate', 'uscite', 'erogante', 'beneficiario'],
            ignoreHiddenRows: false
        });
        // Transpose even entries to be a new column of the previous odd entry;
        // this is done to cleanup spurious rows whose fields are filled with action descriptors (e.g. "Giustizia-Trasferimento")
        // and, at the same time, preserve the information
        const transposedIndexes = [...Array(table.length).keys()].filter(index => index % 2 === 0);
        table.forEach((element, index) => {
            // The first row (index = 0) is spurious (contains the original headers parsed from the HTML table, e.g. Data Operazione);
            // we can safely exclude it from this operation.
            if (index > 0 && transposedIndexes.includes(index)) {
                table[index - 1].descrizione = element.data_operazione;
            }
        });
        // Then delete decriptors-only entries; deletion of row 0 comes for free.
        _.pullAt(table, transposedIndexes);

        return table;
    }

    /**
     * Parses the financial movements for all months displayed on the page.
     * @returns {Object[]} An array of month objects containing financial data.
     */
    function parseAllMonths() {
        const monthsTables = [];
        MONTHS_MAP.forEach((value, key) => {
            monthsTables.push({
                'id': key,
                'month': value,
                'data': parseMonth(key)
            });
        });
        return monthsTables;
    }

    /**
     * Computes the total net money for a given month.
     * @param {Object[]} monthInfo - The financial data for the month.
     * @returns {number} The total net money for the month.
     */
    function computeNetForMonth(monthInfo) {
        let sum = 0;
        monthInfo.forEach(element => {
            if (element.entrate) {
                sum += parseFloat(element.entrate);
            } else {
                sum += parseFloat(element.uscite);
            }
        });
        return sum.toFixed(2);
    }

    /**
     * Computes the net money derived from influences for a given month.
     * @param {Object[]} monthInfo - The financial data for the month.
     * @returns {number} The net money from influences for the month.
     */
    function computeInfluencesNetForMonth(monthInfo) {
        return computeNetByDescriptors(monthInfo, INFLUENCES_DESCRIPTORS);
    }

    /**
     * Computes the money derived from passive influences for a given month.
     * @param {Object[]} monthInfo - The financial data for the month.
     * @returns {number} The net money from passive influences for the month.
     */
    function computeInfluencesPassiveIncomeForMonth(monthInfo) {
        return computeNetByDescriptors(monthInfo, PASSIVE_DESCRIPTORS);
    }

    /**
     * Computes the net money based on the specified descriptors for a given month.
     * @param {Object[]} monthInfo - The financial data for the month.
     * @param {string[]} descriptors - The descriptors to filter financial movements.
     * @returns {number} The net money based on the specified descriptors.
     */
    function computeNetByDescriptors(monthInfo, descriptors) {
        let sum = 0;
        monthInfo.forEach(element => {
            if (descriptors.some(descriptor => element.descrizione.toLowerCase().includes(descriptor.toLowerCase()))) {
                if (element.entrate) {
                    sum += parseFloat(element.entrate);
                } else {
                    sum += parseFloat(element.uscite);
                }
            }
        });
        return sum.toFixed(2);
    }

    /**
     * Computes the money data for each month based on the selected strategy.
     * @param {Function} strategy - The function to compute the money data.
     * @returns {number[]} An array of money data for each month.
     */
    function computeMonthsMoneyData(strategy) {
        const monthsData = parseAllMonths();
        return monthsData.map(element => strategy(element.data));
    }

    /**
     * Initializes and returns the chart container element.
     * @returns {HTMLElement} The chart container element.
     */
    function initializeChartContainer() {
        const chartContainer = document.createElement("div");
        chartContainer.style.width = "80%";
        chartContainer.style.height = "80%";
        chartContainer.style.display = "block";
        chartContainer.style.padding = "2%";
        chartContainer.style.margin = "auto";
        // Put the container under the reports section:
        const placeTheChartHere = document.body.querySelector("td[align='center'][colspan='5'][valign='bottom'][height='100%']");
        placeTheChartHere.insertBefore(chartContainer, placeTheChartHere.firstChild);

        return chartContainer;
    }

    /**
     * Renders the ECharts chart with the computed financial data.
     */
    function renderChart() {
        const chartContainer = initializeChartContainer();
        const expensesChart = echarts.init(chartContainer, 'dark');

        window.addEventListener('resize', () => {
            expensesChart.resize();
        });

        const echartsInfluencesNets = computeMonthsMoneyData(computeInfluencesNetForMonth);
        const echartsTotalNets = computeMonthsMoneyData(computeNetForMonth);
        const echartsPassiveIncome = computeMonthsMoneyData(computeInfluencesPassiveIncomeForMonth);
        const echartsOtherNets = echartsTotalNets.map((value, index) => {
            return (value - echartsInfluencesNets[index]).toFixed(2);
        });

        const option = {
            title: {
                text: 'Movimenti di denaro per mese'
            },
            tooltip: {
                trigger: 'axis'
            },
            legend: {
                data: ['Entrate influenze in passiva', 'Netto delle influenze', 'Netto altre operazioni', 'Netto totale'],
                bottom: '3%'
            },
            toolbox: {
                show: true,
                feature: {
                    dataView: { show: true, readOnly: false },
                    magicType: { show: true, type: ['line', 'bar'] },
                    restore: { show: true },
                    saveAsImage: { show: true }
                }
            },
            calculable: true,
            xAxis: [
                {
                    type: 'category',
                    data: Array.from(MONTHS_MAP.values()).reverse()
                }
            ],
            yAxis: [
                {
                    type: 'value'
                }
            ],
            series: [
                {
                    name: 'Entrate influenze in passiva',
                    type: 'bar',
                    data: echartsPassiveIncome.reverse()
                },
                {
                    name: 'Netto delle influenze',
                    type: 'bar',
                    data: echartsInfluencesNets.reverse()
                },
                {
                    name: 'Netto altre operazioni',
                    type: 'bar',
                    data: echartsOtherNets.reverse()
                },
                {
                    name: 'Netto totale',
                    type: 'bar',
                    data: echartsTotalNets.reverse()
                }
            ]
        };
        expensesChart.setOption(option);
    }

    // Execute rendering
    renderChart();
})();
