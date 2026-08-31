import categoryIconURI from '../../../src/lib/category-icon';

describe('category icons', () => {
    const categories = ['Motion', 'Looks', 'Sound', 'Events', 'Control', 'Sensing', 'Operators', 'Variables',
        'My Blocks'];

    test.each(categories)('%s has a distinct Tinkimo-style icon', category => {
        const color = '#123456';
        const uri = categoryIconURI(category, color);
        const svg = decodeURIComponent(uri);

        expect(svg).toContain(`<title>${category}</title>`);
        expect(svg).toContain(`fill="${color}"`);
        expect(svg).toContain('fill="white"');
        expect(categories.filter(name => categoryIconURI(name, color) === uri)).toEqual([category]);
    });
});
