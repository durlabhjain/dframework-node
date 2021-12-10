import { util } from '../index.js';

test('min', () => {
    expect(util.min([1, 2, 3])).toBe(1);
});

test('min', () => {
    expect(util.min([3, 2, 1])).toBe(1);
});


test('min', () => {
    expect(util.min([1, -1, 3])).toBe(-1);
});


test('max', () => {
    expect(util.max([1, 2, 3])).toBe(3);
});

test('max', () => {
    expect(util.max([3, 4, 2])).toBe(4);
});


test('max', () => {
    expect(util.max(["a", "b", "c"], "")).toBe("c");
});

test('parseDate', () => {
    expect(util.parseDate('20180101000000000')).toStrictEqual(new Date(2018, 0, 1));
});

describe('formatDate', () => {
    const date = new Date(2018, 0, 12, 13, 14, 15);
    it("D-M-Y", () => expect(util.formatDate(date, "D-M-y")).toBe('12-01-18'));
    it("M-D-y", () => expect(util.formatDate(date, "M-D-y")).toBe('01-12-18'));
    it("M-D-Y", () => expect(util.formatDate(date, "M-D-Y")).toBe('01-12-2018'));
    it("D-M-y HH:mm:ss", () => expect(util.formatDateTime(date, "D-M-y HH:mm:ss")).toBe('12-01-18 13:14:15'));
    it("M-D-y HH:mm", () => expect(util.formatDateTime(date, "M-D-y HH:mm")).toBe('01-12-18 13:14'));
    it("M-D-Y HH:mm:ss", () => expect(util.formatDateTime(date, "M-D-Y HH:mm:ss")).toBe('01-12-2018 13:14:15'));
});