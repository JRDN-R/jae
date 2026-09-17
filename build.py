"""Reproducible, network-free assembly after the pinned runtime has been prepared."""
from pathlib import Path
import base64
import hashlib
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
runtime = ROOT / 'runtime'
lib_path = runtime / 'package/dist/bundles/mediabunny.min.cjs'
logo_path = runtime / 'jordan-mark.png'
if not logo_path.exists():
    # Recover the exact original embedded logo from the committed standalone file.
    import re
    embedded = re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)', (ROOT / 'index.html').read_text())
    if embedded is None:
        raise RuntimeError('The standalone HTML does not contain the original logo.')
    runtime.mkdir(exist_ok=True)
    logo_path.write_bytes(base64.b64decode(embedded.group(1)))
for path, expected in [
    (lib_path, 'bebee5632388a5273d219cdd37797264cd6051223476c06678ab2199f82c9a52'),
    (logo_path, '7144ba173edf7d3eed1b08088fd728ef50765b3e40be59dce62b55aa5922b790'),
]:
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f'Pinned asset mismatch: {path.name}; expected {expected}, got {actual}')

logo = 'data:image/png;base64,' + base64.b64encode(logo_path.read_bytes()).decode('ascii')
shell = (ROOT / 'src/shell.html').read_text(encoding='utf-8')
values = {
    '@@LOGO@@': logo,
    '@@CSS@@': (ROOT / 'src/style.css').read_text(encoding='utf-8'),
    '@@RUNTIME@@': lib_path.read_text(encoding='utf-8'),
    '@@APP@@': (ROOT / 'src/core.js').read_text(encoding='utf-8') + '\n' + (ROOT / 'src/app.js').read_text(encoding='utf-8'),
}
for key, value in values.items():
    if key in ('@@RUNTIME@@', '@@APP@@'):
        value = value.replace('</script', '<\\/script')
    shell = shell.replace(key, value)
if any(key in shell for key in values):
    raise RuntimeError('An HTML build placeholder was not replaced.')
(ROOT / 'index.html').write_text(shell, encoding='utf-8')

# Distribute the corresponding unmodified MPL source with the embedded executable.
vendor = ROOT / 'vendor'
vendor.mkdir(exist_ok=True)
shutil.copyfile(runtime / 'package/LICENSE', vendor / 'MEDIABUNNY-LICENSE.txt')
package = runtime / 'package'
source_files = sorted((package / 'src').rglob('*')) + [package / 'LICENSE', package / 'README.md', package / 'package.json']
with zipfile.ZipFile(vendor / 'mediabunny-1.57.0-source.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in source_files:
        if path.is_file():
            info = zipfile.ZipInfo(str(Path('mediabunny-1.57.0') / path.relative_to(package)), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
print(f'Built index.html: {len(shell.encode("utf-8")):,} bytes')
