"""Reproducible, network-free assembly after the pinned runtime has been prepared."""
from pathlib import Path
import hashlib
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
runtime = ROOT / 'runtime'
lib_path = runtime / 'package/dist/bundles/mediabunny.min.cjs'
for path, expected in [
    (lib_path, 'bebee5632388a5273d219cdd37797264cd6051223476c06678ab2199f82c9a52'),
]:
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f'Pinned asset mismatch: {path.name}; expected {expected}, got {actual}')

shell = (ROOT / 'src/shell.html').read_text(encoding='utf-8')
values = {
    '@@CSS@@': (ROOT / 'src/style.css').read_text(encoding='utf-8'),
    '@@RUNTIME@@': lib_path.read_text(encoding='utf-8'),
    '@@APP@@': '\n'.join((ROOT / 'src' / name).read_text(encoding='utf-8') for name in ['core.js', 'edit-backup.js', 'file-storage.js', 'app.js']),
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
