import { describe, expect, it } from 'vitest';
import { GLOSSARY_ITEMS } from './trading-glossary';

describe('trading glossary zone-direction explanation', () => {
    it('explains that the break, not the zone name, determines direction', () => {
        expect(GLOSSARY_ITEMS).toContainEqual([
            'Zone name vs direction',
            "A zone's name (supply/demand) is not the trade direction. The BREAK of a zone decides the direction.",
        ]);
    });
});
