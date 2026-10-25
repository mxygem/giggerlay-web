// The synthetic 30-stop route used by the end-to-end import test. Stop 1 is
// the station pickup, 21 and 22 share an address, 14 has 3 packages.
// Addresses are made up.

const streets = [
  ['1007', '', 'ANITA', 'AVE', 'GROSSE POINTE WOODS'],
  ['2214', '', 'VERNIER', 'RD', 'GROSSE POINTE WOODS'],
  ['845', '', 'LOCHMOOR', 'BLVD', 'GROSSE POINTE WOODS'],
  ['19750', '', 'MACK', 'AVE', 'GROSSE POINTE WOODS'],
  ['1316', '', 'HAMPTON', 'RD', 'GROSSE POINTE WOODS'],
  ['20131', '', 'LANCASTER', 'ST', 'HARPER WOODS'],
  ['417', '', 'COUNTRY CLUB', 'DR', 'GROSSE POINTE WOODS'],
  ['1980', '', 'BRYS', 'DR', 'GROSSE POINTE WOODS'],
  ['633', '', 'ROSLYN', 'RD', 'GROSSE POINTE WOODS'],
  ['20510', '', 'WOODMONT', 'ST', 'HARPER WOODS'],
  ['1549', '', 'FAIRHOLME', 'RD', 'GROSSE POINTE WOODS'],
  ['818', '', 'BRIARCLIFF', 'DR', 'GROSSE POINTE WOODS'],
  ['21001', '', 'KELLY', 'RD', 'HARPER WOODS'],
  ['1268', '', 'HOLLYWOOD', 'AVE', 'GROSSE POINTE WOODS'],
  ['2075', '', 'STANHOPE', 'ST', 'GROSSE POINTE WOODS'],
  ['910', '', 'HAWTHORNE', 'RD', 'GROSSE POINTE WOODS'],
  ['20900', '', 'BEACONSFIELD', 'ST', 'HARPER WOODS'],
  ['1742', '', 'OXFORD', 'RD', 'GROSSE POINTE WOODS'],
  ['365', '', 'MOROSS', 'RD', 'GROSSE POINTE FARMS'],
  ['20225', '', 'MACK', 'AVE APT 12', 'GROSSE POINTE WOODS'],
  ['20225', '', 'MACK', 'AVE APT 12', 'GROSSE POINTE WOODS'],
  ['1124', '', 'BEDFORD', 'RD', 'GROSSE POINTE PARK'],
  ['801', 'N', 'RENAUD', 'RD', 'GROSSE POINTE WOODS'],
  ['1455', '', 'BOURNEMOUTH', 'CIR', 'GROSSE POINTE WOODS'],
  ['676', '', 'TOURAINE', 'RD', 'GROSSE POINTE FARMS'],
  ['22340', 'E', 'JEFFERSON', 'AVE', 'ST CLAIR SHORES'],
  ['1501', '', 'TORREY', 'RD', 'GROSSE POINTE WOODS'],
  ['20845', '', 'HUNT CLUB', 'DR', 'HARPER WOODS'],
  ['1231', '', 'NEWCASTLE', 'RD', 'GROSSE POINTE PARK'],
];

/** @returns {{number: number, street: string, city: string, packages: number, pickup: boolean}[]} */
export function fixtureRows() {
  const rows = [{ number: 1, street: '24600 HALLWOOD CT', city: 'FARMINGTON HILLS', packages: 0, pickup: true }];
  streets.forEach(([num, dir, name, type, city], i) => {
    const n = i + 2;
    rows.push({
      number: n,
      street: [num, dir, name, type].filter(Boolean).join(' '),
      city,
      packages: n === 14 ? 3 : n === 21 || n === 22 ? 2 : 1,
      pickup: false,
    });
  });
  return rows;
}

export const HEADER = '# H-24.1B • Scheduled 3:00 - 8:00 AM';
