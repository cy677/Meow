"""Import the reviewed Kenney subset. Python standard library only; not used at runtime.
Pinned archive hashes deliberately fail closed when upstream content changes.
"""
from pathlib import Path
import hashlib
import io
import json
import struct
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKS = {
    'cube-pets': ('44e58e945f-1774520254/kenney_cube-pets_1.0.zip', 'b3bdc99a2ec92c687b875718c5d01e9231d2711ed0e2845f295b474bb42a1283', '2.0', 'GLB', ['animal-chick', 'animal-bunny', 'animal-bee', 'animal-caterpillar']),
    'toy-car-kit': ('42e19cc426-1736346027/kenney_toy-car-kit.zip', '26c11bbb77102b8dd00cdaf7b2c7ab692416d750dd064de886d809acec346782', '1.2', 'GLB', ['vehicle-speedster', 'vehicle-racer', 'vehicle-truck', 'track-wide-straight-hill-complete', 'track-wide-straight']),
    'brick-kit': ('46a22f3d08-1716981002/kenney_brick-kit.zip', 'b303d293c278fab713eed28395829b18513b171d2562f7f518c3355c2896861a', '1.0', 'GLB', ['round-lq-' + n for n in ['brick-1x1', 'brick-1x2', 'brick-1x4', 'brick-2x2', 'brick-2x4', 'brick-1x1-round', 'brick-slope-1x2', 'brick-slope-2x2', 'brick-corner', 'plate-2x4']]),
    'furniture-kit': ('440e0608a4-1677580847/kenney_furniture-kit.zip', 'e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0', '2.0', 'GLTF', ['stoolBar', 'sideTable', 'bookcaseOpenLow', 'lampRoundFloor']),
}

def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    manifest = {'schemaVersion': 1, 'license': 'CC0-1.0', 'reviewedAt': '2026-09-22', 'packs': [], 'models': []}
    # Validate everything before replacing any checked-in resource.
    pending = {}
    for pack, (suffix, expected, version, fmt, names) in PACKS.items():
        url = f'https://kenney.nl/media/pages/assets/{pack}/{suffix}'
        with urllib.request.urlopen(url, timeout=90) as response:
            raw = response.read(64 * 1024 * 1024 + 1)
        if digest(raw) != expected:
            raise ValueError(f'{pack}: archive SHA256 mismatch; review upstream changes before updating')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            license_bytes = archive.read('License.txt')
            if 'Creative Commons Zero, CC0' not in license_bytes.decode('utf-8-sig'):
                raise ValueError(f'{pack}: expected explicit CC0 license')
            pending[f'third_party/kenney/{pack}/License.txt'] = license_bytes
            manifest['packs'].append({'id': pack, 'version': version, 'source': f'https://kenney.nl/assets/{pack}', 'archiveUrl': url, 'archiveSha256': expected, 'license': 'CC0-1.0'})
            for name in names:
                member = f'Models/{fmt} format/{name}.glb'
                model = archive.read(member)
                if model[:4] != b'glTF' or struct.unpack_from('<I', model, 8)[0] != len(model):
                    raise ValueError(f'{member}: invalid GLB')
                json_length = struct.unpack_from('<I', model, 12)[0]
                document = json.loads(model[20:20 + json_length])
                for obj in document.get('buffers', []) + document.get('images', []):
                    if obj.get('uri') and not obj['uri'].startswith('data:'):
                        raise ValueError(f'{member}: external resource must be embedded before import')
                target = f'public/models/kenney/{pack}/{name}.glb'
                pending[target] = model
                manifest['models'].append({'pack': pack, 'file': target, 'sourceFile': member, 'sha256': digest(model), 'bytes': len(model), 'animations': [a.get('name', '') for a in document.get('animations', [])]})
                print(f'{pack}/{name}: {len(model)} bytes')
    pending['third_party/kenney/manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    for rel, data in pending.items():
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(f"Imported {len(manifest['models'])} models, {sum(m['bytes'] for m in manifest['models'])} bytes; all embedded and CC0")


if __name__ == '__main__':
    main()
