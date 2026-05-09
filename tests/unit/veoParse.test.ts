import {
  extractVeoVideoUrl,
  extractPageTitle,
  stripSiteSuffix,
  sanitizeFilename,
} from '../../src/main/veo/parse';

describe('extractVeoVideoUrl', () => {
  test('finds a bare video.mp4 URL', () => {
    const html = `<video src="https://c.veo.co/12345/video.mp4"></video>`;
    expect(extractVeoVideoUrl(html)).toBe('https://c.veo.co/12345/video.mp4');
  });

  test('finds a URL inside JSON with escaped slashes', () => {
    const html = `<script>{"video_url":"https:\\/\\/c.veo.co\\/abc\\/video.mp4"}</script>`;
    expect(extractVeoVideoUrl(html)).toBe('https://c.veo.co/abc/video.mp4');
  });

  test('finds a URL with a query string', () => {
    const html = `<meta content="https://c.veo.co/x/video.mp4?token=abc">`;
    expect(extractVeoVideoUrl(html)).toBe('https://c.veo.co/x/video.mp4?token=abc');
  });

  test('returns null when no video.mp4 URL is present', () => {
    expect(extractVeoVideoUrl('<html>nothing here</html>')).toBeNull();
  });

  test('does not match unrelated mp4 paths', () => {
    const html = '<a href="https://example.com/intro.mp4">x</a>';
    expect(extractVeoVideoUrl(html)).toBeNull();
  });

  test('returns the first video.mp4 URL when several exist', () => {
    const html = `
      <video src="https://a.example/video.mp4"></video>
      <video src="https://b.example/video.mp4"></video>
    `;
    expect(extractVeoVideoUrl(html)).toBe('https://a.example/video.mp4');
  });
});

describe('extractPageTitle', () => {
  test('reads the <title> tag and decodes entities', () => {
    const html = '<html><head><title>Reds U13 vs Blues &amp; Greens</title></head></html>';
    expect(extractPageTitle(html)).toBe('Reds U13 vs Blues & Greens');
  });

  test('returns null when no <title> is present', () => {
    expect(extractPageTitle('<html></html>')).toBeNull();
  });

  test('handles multiline titles', () => {
    const html = '<title>\n  Match Day\n</title>';
    expect(extractPageTitle(html)).toBe('Match Day');
  });
});

describe('stripSiteSuffix', () => {
  test('strips a trailing " | Veo"', () => {
    expect(stripSiteSuffix('Reds U13 vs Blues | Veo')).toBe('Reds U13 vs Blues');
  });

  test('strips a trailing " - Veo"', () => {
    expect(stripSiteSuffix('Reds U13 vs Blues - Veo')).toBe('Reds U13 vs Blues');
  });

  test('leaves titles without a Veo suffix alone', () => {
    expect(stripSiteSuffix('Reds U13 vs Blues')).toBe('Reds U13 vs Blues');
  });
});

describe('sanitizeFilename', () => {
  test('removes Windows-invalid characters', () => {
    expect(sanitizeFilename('Reds: U13 / vs <Blues>?')).toBe('Reds U13 vs Blues');
  });

  test('collapses runs of whitespace', () => {
    expect(sanitizeFilename('Reds   U13   vs   Blues')).toBe('Reds U13 vs Blues');
  });

  test('caps length at 120 characters', () => {
    const long = 'x'.repeat(300);
    expect(sanitizeFilename(long).length).toBe(120);
  });
});
