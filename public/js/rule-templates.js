// Ready-made stay rules and thresholds people commonly need, each with its official source; a
// template only fills in the rule dialog, which the traveler checks and saves. The ledger stays
// a guide, not tax advice. Pure, unit tested in Node.
import { t } from './i18n.js';

const year = (yearStart, maxDays) => ({ period: 'year', yearStart, maxDays, windowDays: 365, warnDays: 30 });

export const RULE_TEMPLATES = Object.freeze([
    {
        id: 'turkey-90-180', kind: 'stay', countries: ['TUR'], maxDays: 90, windowDays: 180, warnDays: 10, dayRule: 'presence',
        get name() { return t('Türkiye 90/180'); },
        source: 'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa'
    },
    {
        id: 'uk-srt-16', kind: 'threshold', countries: ['GBR'], ...year('04-06', 16),
        get name() { return t('UK residence test: 16 days'); },
        get note() { return t('Fewer days in a tax year and you are not UK resident, if you were resident in one of the three before. The UK counts the days you are there at midnight.'); },
        source: 'https://www.gov.uk/government/publications/rdr3-statutory-residence-test-srt'
    },
    {
        id: 'uk-srt-46', kind: 'threshold', countries: ['GBR'], ...year('04-06', 46),
        get name() { return t('UK residence test: 46 days'); },
        get note() { return t('Fewer days in a tax year and you are not UK resident, if you were not resident in any of the three before.'); },
        source: 'https://www.gov.uk/government/publications/rdr3-statutory-residence-test-srt'
    },
    {
        id: 'uk-srt-183', kind: 'threshold', countries: ['GBR'], ...year('04-06', 183),
        get name() { return t('UK residence test: 183 days'); },
        get note() { return t('This many days in a tax year makes you UK resident.'); },
        source: 'https://www.gov.uk/government/publications/rdr3-statutory-residence-test-srt'
    },
    {
        id: 'australia-183', kind: 'threshold', countries: ['AUS'], ...year('07-01', 183),
        get name() { return t('Australia: 183 days in the income year'); },
        source: 'https://www.ato.gov.au/individuals-and-families/coming-to-australia-or-going-overseas/your-tax-residency'
    },
    {
        id: 'india-182', kind: 'threshold', countries: ['IND'], ...year('04-01', 182),
        get name() { return t('India: 182 days in the financial year'); },
        source: 'https://incometaxindia.gov.in/Pages/i-am/non-resident.aspx'
    },
    {
        id: 'canada-183', kind: 'threshold', countries: ['CAN'], ...year('01-01', 183),
        get name() { return t('Canada: 183 days in the year'); },
        source: 'https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/individuals-leaving-entering-canada-non-residents/determining-your-residency-status.html'
    },
    {
        id: 'new-zealand-183', kind: 'threshold', countries: ['NZL'], period: 'rolling', windowDays: 365, maxDays: 183, warnDays: 30, yearStart: '01-01',
        get name() { return t('New Zealand: 183 days in any 12 months'); },
        source: 'https://www.ird.govt.nz/international-tax/individuals/tax-residency'
    },
    {
        id: 'treaty-183', kind: 'threshold', countries: [], period: 'rolling', windowDays: 365, maxDays: 183, warnDays: 30, yearStart: '01-01',
        get name() { return t('183 days in any 12 months'); },
        get note() { return t('The test many tax treaties use for salaried work abroad; name the country it is for.'); },
        source: 'https://www.oecd.org/en/topics/sub-issues/model-tax-convention-on-income-and-on-capital.html'
    }
]);

/** The templates of a kind of rule. */
export const templatesOf = kind => RULE_TEMPLATES.filter(template => template.kind === kind);

/** A template as the rule dialog's starting values: a rule without an id, to check and save. */
export function templateDraft(template) {
    const { id, source, note, ...rule } = template;
    return { ...rule, name: template.name };
}
