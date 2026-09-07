# Workstation favicon source

The Workstation favicon reuses the existing Sage Mate purple circular `S`
mark. It is not derived from the vLLM upstream `V` icon, a personal photo, or
the DataSys mark.

## Controlled source

- Repository: <https://github.com/RIDE-Lab/sage-mate>
- Verified checkout on connected host `180-ascend-bench` (`host-192-168-0-6`):
  `1a5a8372bacc705fc56d5fd82f78405748a17d5d`
- First repository commit containing the asset:
  `2dd47cfef3b2aebd97fa20f1d313f1a71387ae95`
- Repository path: `src/sage_faculty_twin/web/icon.png`
- Git blob: `b2d81ffd533f4cbd256c59ecc745e739685bd50b`
- Source PNG SHA256:
  `a18de1aefd83a526e2cab7ea0274d7552ac14890787b27dcc760580ce1098271`
- Source format: RGB PNG, 1254 x 1254

The checked-out file and the decoded Git blob produced the same SHA256, so the
favicon source does not depend on uncommitted Sage Mate working-tree changes.

## Workstation artifact

- App Router path: `src/app/favicon.ico`
- Output: ICO containing one 64 x 64 image
- Generated favicon SHA256:
  `e50cde9bebb72d34fb2fb0db0c881b277a62aec3193f0326a7be368be73e03f7`
- Mechanical conversion:

  ```sh
  ffmpeg -i icon.png -vf scale=64:64:flags=lanczos favicon.ico
  ```

The production standalone gate requests `/favicon.ico`, accepts only standard
ICO MIME types, validates the ICO directory and image bounds, and rejects image
payloads that are neither PNG nor a supported DIB.
