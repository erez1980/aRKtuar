# Bank export coverage

The tests use synthetic rows with representative Israeli bank/card column labels:
Hapoalim, Leumi, Discount, Mizrahi-Tefahot, Max, Isracard and Cal.
No genuine customer export was supplied; these fixtures do not certify every
bank's current layout. Validate with anonymized actual exports before claiming
bank-wide support. No customer documents or account data should be committed.

For unfamiliar layouts, the UI opens a local column-mapping dialog. Choose the
header row (0 for no headers), date, description, and either signed amount or
credit/debit columns. For card exports with positive expenses, select the
expense-positive sign convention. Refunds then become credits.
