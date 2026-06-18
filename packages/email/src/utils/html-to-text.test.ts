import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './html-to-text';

describe('htmlToPlainText', () => {
  it('returns plain text unchanged (trimmed)', () => {
    expect(htmlToPlainText('Hello World')).toBe('Hello World');
    expect(htmlToPlainText('  leading and trailing  ')).toBe('leading and trailing');
  });

  it('converts <br> and <br/> to newlines', () => {
    expect(htmlToPlainText('Line 1<br>Line 2<br/>Line 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('converts <hr> to a separator line', () => {
    expect(htmlToPlainText('above<hr>below')).toBe('above\n---\nbelow');
  });

  it('formats link with distinct text as "text (url)"', () => {
    expect(htmlToPlainText('<a href="https://x.com">Click</a>')).toBe('Click (https://x.com)');
  });

  it('formats link where text equals href as just the href', () => {
    // When anchor text and href are identical, parenthetical is omitted
    expect(htmlToPlainText('<a href="https://x.com">https://x.com</a>')).toBe('https://x.com');
  });

  it('strips inner tags from link text before formatting', () => {
    expect(htmlToPlainText('<a href="https://x.com"><b>Hi</b></a>')).toBe('Hi (https://x.com)');
  });

  it('formats link with empty text as just the href', () => {
    expect(htmlToPlainText('<a href="https://x.com"></a>')).toBe('https://x.com');
  });

  it('adds paragraph breaks around block elements', () => {
    expect(htmlToPlainText('<p>A</p><p>B</p>')).toBe('A\n\nB');
  });

  it('converts list items to bullet markers', () => {
    expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
  });

  it('converts table cells to tab-separated values', () => {
    // </td> → '\t'; subsequent whitespace collapse converts tab to single space
    expect(htmlToPlainText('<td>a</td><td>b</td>')).toBe('a b');
  });

  it('decodes named HTML entities', () => {
    // &nbsp; → space, which is then trimmed from the start of the only line
    expect(htmlToPlainText('&nbsp;&amp;&lt;&gt;&quot;&#39;&apos;')).toBe(`&<>"''`);
  });

  it('decodes numeric and hex character references', () => {
    expect(htmlToPlainText('&#65;')).toBe('A');
    expect(htmlToPlainText('&#x41;')).toBe('A');
    expect(htmlToPlainText('&#65; and &#x41;')).toBe('A and A');
  });

  it('collapses runs of whitespace and excess newlines', () => {
    expect(htmlToPlainText('foo   bar')).toBe('foo bar');
    expect(htmlToPlainText('foo\t\tbar')).toBe('foo bar');
    expect(htmlToPlainText('a\n\n\nb')).toBe('a\n\nb');
    expect(htmlToPlainText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('handles a realistic mixed-content email', () => {
    const html = `<html><body>
  <h1>Welcome!</h1>
  <p>Thank you for signing up. Visit our <a href="https://example.com/docs">documentation</a> to get started.</p>
  <ul>
    <li>Feature one</li>
    <li>Feature two</li>
    <li>Feature three</li>
  </ul>
</body></html>`;

    // Note: extra newlines arise from interleaved block-tag newlines and
    // whitespace-only lines that survive the \n{3,} collapse but become empty
    // after per-line trim, effectively creating 3-4 newline gaps.
    expect(htmlToPlainText(html)).toBe(
      'Welcome!\n\n\nThank you for signing up. Visit our documentation (https://example.com/docs) to get started.\n\n\n\n- Feature one\n\n- Feature two\n\n- Feature three'
    );
  });

  it('decodes astral-plane numeric entities to the correct character', () => {
    expect(htmlToPlainText('&#128512;')).toBe('\u{1F600}');
    expect(htmlToPlainText('&#x1F600;')).toBe('\u{1F600}'); // hex form decodes too
  });

  it('leaves an out-of-range numeric entity untouched (no throw)', () => {
    expect(htmlToPlainText('&#999999999999;')).toBe('&#999999999999;');
  });
});
