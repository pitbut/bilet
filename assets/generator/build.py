"""Собирает все модели в ../models и пишет manifest.json. Запуск: python3 build.py"""
import json
import os

from mesh import Model
from models import BRANCH_IDS, INDUSTRIES, OTHERS

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")


def main():
    manifest, total_tris = [], 0
    for ind_id, ind_name, branch_names, builders in INDUSTRIES:
        for b_id, b_name, build in zip(BRANCH_IDS, branch_names, builders):
            for level in (1, 2, 3):
                mid = f"{ind_id}_{b_id}_{level}"
                m = Model(mid)
                build(m, level)
                rel = f"industries/{ind_id}/{mid}.glb"
                os.makedirs(os.path.dirname(os.path.join(ROOT, rel)), exist_ok=True)
                tris = m.save(os.path.join(ROOT, rel))
                total_tris += tris
                manifest.append({"id": mid, "file": rel, "category": "industry", "industry": ind_id,
                                 "industryName": ind_name, "branch": b_id, "branchName": b_name,
                                 "level": level, "triangles": tris})
    for cat, mid, name, build in OTHERS:
        m = Model(mid)
        build(m)
        rel = f"{cat}/{mid}.glb"
        os.makedirs(os.path.dirname(os.path.join(ROOT, rel)), exist_ok=True)
        tris = m.save(os.path.join(ROOT, rel))
        total_tris += tris
        manifest.append({"id": mid, "file": rel, "category": cat, "name": name, "triangles": tris})
    with open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"{len(manifest)} моделей, {total_tris} треугольников всего")


if __name__ == "__main__":
    main()
