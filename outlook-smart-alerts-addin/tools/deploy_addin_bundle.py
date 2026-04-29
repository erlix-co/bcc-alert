import os
from pathlib import Path

import paramiko


def ensure_remote_dir(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    current = ""
    for part in parts:
        current = f"{current}/{part}"
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)


def upload_dir(sftp: paramiko.SFTPClient, local_dir: Path, remote_dir: str) -> None:
    ensure_remote_dir(sftp, remote_dir)
    for item in local_dir.iterdir():
        remote_path = f"{remote_dir}/{item.name}"
        if item.is_dir():
            upload_dir(sftp, item, remote_path)
        else:
            sftp.put(str(item), remote_path)


def remove_remote_tree(ssh: paramiko.SSHClient, remote_dir: str) -> None:
    command = f"rm -rf {remote_dir}"
    ssh.exec_command(command)


def main() -> None:
    host = os.environ["DEPLOY_HOST"]
    user = os.environ["DEPLOY_USER"]
    password = os.environ["DEPLOY_PASS"]
    local_root = Path(os.environ["LOCAL_BUNDLE_DIR"]).resolve()
    remote_root = os.environ["REMOTE_BUNDLE_DIR"]
    remote_staging_root = os.environ.get("REMOTE_STAGING_DIR", f"/home/{user}/bcc-alert-addin-upload")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=host, username=user, password=password, timeout=20)
    try:
        sftp = ssh.open_sftp()
        try:
            remove_remote_tree(ssh, remote_staging_root)
            upload_dir(sftp, local_root, remote_staging_root)
        finally:
            sftp.close()

        sudo_script = (
            f"rm -rf '{remote_root}' && "
            f"mkdir -p '{remote_root}' && "
            f"cp -a '{remote_staging_root}/.' '{remote_root}/' && "
            f"chown -R www-data:www-data '{remote_root}'"
        )
        stdin, stdout, stderr = ssh.exec_command(f"sudo -S -p '' bash -lc \"{sudo_script}\"", get_pty=True)
        stdin.write(password + "\n")
        stdin.flush()
        exit_code = stdout.channel.recv_exit_status()
        err_text = stderr.read().decode("utf-8", errors="replace").strip()
        if exit_code != 0:
            raise RuntimeError(f"Remote sudo deploy failed: {err_text or f'exit {exit_code}'}")
    finally:
        ssh.close()

    print(f"Uploaded bundle to {remote_root} via {remote_staging_root}")


if __name__ == "__main__":
    main()
