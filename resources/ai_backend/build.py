import os
import PyInstaller.__main__

backend_dir = r"d:\Projects\T.A.D.A.S.H.I\resources\ai_backend"

PyInstaller.__main__.run([
    os.path.join(backend_dir, 'ai_service_server.py'),
    '--onefile',
    '--name=ai_backend',
    '--distpath=' + os.path.join(backend_dir, 'dist'),
    '--workpath=' + os.path.join(backend_dir, 'build'),
    '--hidden-import=kokoro_onnx',
    '--hidden-import=sounddevice',
    '--hidden-import=soundfile',
    '--hidden-import=sherpa_onnx',
    '--hidden-import=numpy',
])
