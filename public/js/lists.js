// The lists of countries a traveler can count against (ADR 0015): every territory the map
// draws, or the members and observer states of the United Nations. A list only decides which
// territories count, and the UN list counts a member for its overseas parts; places always
// belong to the territory the map draws them in. Pure, unit tested in Node.
import { t } from './i18n.js';

// The 193 UN member states by map code; Natural Earth codes South Sudan SDS.
export const UN_MEMBERS = Object.freeze(`
    AFG ALB DZA AND AGO ATG ARG ARM AUS AUT AZE BHS BHR BGD BRB BLR BEL BLZ BEN BTN BOL BIH BWA BRA BRN BGR
    BFA BDI CPV KHM CMR CAN CAF TCD CHL CHN COL COM COG CRI CIV HRV CUB CYP CZE PRK COD DNK DJI DMA DOM ECU
    EGY SLV GNQ ERI EST SWZ ETH FJI FIN FRA GAB GMB GEO DEU GHA GRC GRD GTM GIN GNB GUY HTI HND HUN ISL IND
    IDN IRN IRQ IRL ISR ITA JAM JPN JOR KAZ KEN KIR KWT KGZ LAO LVA LBN LSO LBR LBY LIE LTU LUX MDG MWI MYS
    MDV MLI MLT MHL MRT MUS MEX FSM MCO MNG MNE MAR MOZ MMR NAM NRU NPL NLD NZL NIC NER NGA MKD NOR OMN PAK
    PLW PAN PNG PRY PER PHL POL PRT QAT KOR MDA ROU RUS RWA KNA LCA VCT WSM SMR STP SAU SEN SRB SYC SLE SGP
    SVK SVN SLB SOM ZAF SDS ESP LKA SDN SUR SWE CHE SYR TJK THA TLS TGO TON TTO TUN TUR TKM TUV UGA UKR ARE
    GBR TZA USA URY UZB VUT VEN VNM YEM ZMB ZWE`.trim().split(/\s+/));

// The two non-member observer states: the Holy See (Vatican City) and Palestine.
export const UN_OBSERVERS = Object.freeze(['VAT', 'PSX']);

// Overseas parts of members that the map draws on their own because they are outside the
// Schengen area (ADR 0024). They are part of the member state, so on the UN list having been
// to one counts the member.
export const MEMBER_PARTS = Object.freeze({
    GUF: 'FRA', GLP: 'FRA', MTQ: 'FRA', REU: 'FRA', MYT: 'FRA', SJM: 'NOR', BES: 'NLD'
});

export const COUNTRY_LISTS = Object.freeze([
    { id: 'all', get label() { return t('Every territory on the map'); }, get phrase() { return t('every territory on the map'); }, get unit() { return t('territories'); }, ids: null },
    {
        id: 'un', get label() { return t('UN members and observer states'); }, get phrase() { return t('UN members and observer states'); }, get unit() { return t('UN countries'); },
        ids: Object.freeze([...UN_MEMBERS, ...UN_OBSERVERS]), partOf: MEMBER_PARTS
    }
]);

export function countryList(id) {
    return COUNTRY_LISTS.find(list => list.id === id) || COUNTRY_LISTS[0];
}

/** What the share of countries been to is a share of. */
export function shareLabel(listId) {
    return listId === 'un' ? t('of UN countries') : t('of the world');
}

/** The countries of the map that a list counts, in map order. */
export function countedCountries(index, listId) {
    const { ids } = countryList(listId);
    if (!ids) return index.countries;
    const counted = new Set(ids);
    return index.countries.filter(country => counted.has(country.id));
}
