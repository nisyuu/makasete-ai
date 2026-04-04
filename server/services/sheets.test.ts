import { describe, it, expect } from 'vitest';
import { mapRowsToObjects } from './sheets';

describe('sheets service utilities', () => {
    describe('mapRowsToObjects', () => {
        it('should map rows to objects using header as keys', () => {
            const header = ['ID', 'Name', 'Price'];
            const rows = [['1', 'Apple', '100'], ['2', 'Banana', '200']];
            const result = mapRowsToObjects(header, rows);
            
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ id: '1', name: 'Apple', price: '100' });
            expect(result[1]).toEqual({ id: '2', name: 'Banana', price: '200' });
        });

        it('should convert header keys to snake_case', () => {
            const header = ['Product Name', 'DiscountPrice', 'User-Count', 'Already_Snake'];
            const rows = [['Apple', '80', '10', 'Yes']];
            const result = mapRowsToObjects(header, rows);
            
            expect(result[0]).toEqual({
                product_name: 'Apple',
                discount_price: '80',
                user_count: '10',
                already_snake: 'Yes'
            });
        });

        it('should handle empty cells', () => {
            const header = ['ID', 'Name'];
            const rows = [['1', '']];
            const result = mapRowsToObjects(header, rows);
            expect(result[0].name).toBe('');
        });

        it('should skip empty header keys', () => {
            const header = ['ID', '', 'Name'];
            const rows = [['1', 'Secret', 'Apple']];
            const result = mapRowsToObjects(header, rows);
            expect(result[0]).toEqual({ id: '1', name: 'Apple' });
            expect(Object.keys(result[0])).not.toContain('');
        });
    });
});
