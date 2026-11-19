<?php
/**
 * Run once from the deployed WebApp directory:
 *   php scripts/seed_role_activation_keys.php [duration_days]
 * Creates two keys for each role buyer/seller/admin. Plaintext keys are printed only to stdout.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit("Not found\n"); }
$webRoot = dirname(__DIR__);
$configPath = $webRoot . '/config/database.php';
if (!is_file($configPath)) { fwrite(STDERR, "Missing config/database.php. Copy your private deployment config first.\n"); exit(2); }
// Match api.php: read only KEY_ENCRYPTION_SECRET from the private .env in the parent directory.
if (!getenv('KEY_ENCRYPTION_SECRET')) {
    $envPath = dirname($webRoot) . DIRECTORY_SEPARATOR . '.env';
    if (is_readable($envPath)) {
        foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
            list($name, $value) = explode('=', $line, 2);
            if (trim($name) !== 'KEY_ENCRYPTION_SECRET') continue;
            $value = trim($value);
            if (strlen($value) >= 2 && (($value[0] === "'" && substr($value, -1) === "'") || ($value[0] === '"' && substr($value, -1) === '"'))) $value = substr($value, 1, -1);
            if ($value !== '') { putenv('KEY_ENCRYPTION_SECRET=' . $value); $_ENV['KEY_ENCRYPTION_SECRET'] = $value; $_SERVER['KEY_ENCRYPTION_SECRET'] = $value; }
            break;
        }
    }
}
$config = require $configPath;
$envSecret = getenv('KEY_ENCRYPTION_SECRET');
if ($envSecret !== false && trim((string)$envSecret) !== '') $config['key_encryption_secret'] = trim((string)$envSecret);
$secret = trim((string)($config['key_encryption_secret'] ?? ''));
if ($secret === '') { fwrite(STDERR, "KEY_ENCRYPTION_SECRET is empty; set the same stable secret used by api.php before creating role keys.\n"); exit(2); }
$days = isset($argv[1]) ? (int)$argv[1] : 30;
if ($days < 1 || $days > 3650) { fwrite(STDERR, "Duration must be an integer from 1 to 3650 days.\n"); exit(2); }
if (!function_exists('openssl_encrypt')) { fwrite(STDERR, "PHP OpenSSL extension is required.\n"); exit(2); }
$host = (string)($config['db_host'] ?? '127.0.0.1');
$port = (int)($config['db_port'] ?? 3306);
$name = (string)($config['db_name'] ?? '');
$user = (string)($config['db_user'] ?? '');
$pass = (string)($config['db_pass'] ?? '');
if ($name === '' || $user === '' || strpos($name, 'YOUR_') === 0 || strpos($user, 'YOUR_') === 0) { fwrite(STDERR, "Database settings are incomplete in config/database.php.\n"); exit(2); }
try {
    $pdo = new PDO("mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    $col = $pdo->query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='subscription_keys' AND COLUMN_NAME='role_on_activate'")->fetch();
    if ((int)($col['n'] ?? 0) !== 1) { fwrite(STDERR, "Missing role_on_activate. Apply migrations/004_role_activation_keys.sql first.\n"); exit(2); }
    $existing = $pdo->query("SELECT COUNT(*) AS n FROM subscription_keys WHERE role_on_activate IN ('buyer','seller','admin')")->fetch();
    if ((int)($existing['n'] ?? 0) > 0) { fwrite(STDERR, "Role activation keys already exist. Refusing to seed duplicates. If this is an intentional repair, inspect the DB manually.\n"); exit(3); }
    $master = hash('sha256', $secret, true);
    $encKey = hash_hmac('sha256', 'encryption', $master, true);
    $macKey = hash_hmac('sha256', 'authentication', $master, true);
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $group = function () use ($alphabet) { $out=''; for($i=0;$i<4;$i++) $out .= $alphabet[random_int(0, strlen($alphabet)-1)]; return $out; };
    $encrypt = function ($plain) use ($encKey,$macKey) { $iv=random_bytes(16); $cipher=openssl_encrypt($plain,'aes-256-cbc',$encKey,OPENSSL_RAW_DATA,$iv); if($cipher===false) throw new RuntimeException('Unable to encrypt a key.'); return base64_encode($iv.hash_hmac('sha256',$iv.$cipher,$macKey,true).$cipher); };
    $insert = $pdo->prepare('INSERT INTO subscription_keys (key_hash,key_prefix,key_ciphertext,usable,duration_days,role_on_activate) VALUES (?,?,?,1,?,?)');
    $pdo->beginTransaction();
    $issued=[];
    foreach (['buyer'=>2,'seller'=>2,'admin'=>2] as $role=>$count) {
        for ($i=0;$i<$count;$i++) {
            $raw='BP-'.strtoupper($role).'-'.$group().'-'.$group().'-'.$group().'-'.$group();
            $insert->execute([hash('sha256',$raw),'ROLE-'.strtoupper($role),$encrypt($raw),$days,$role]);
            $issued[]=['role'=>$role,'key'=>$raw];
        }
    }
    $pdo->commit();
    echo "Created six role activation keys (duration: {$days} days). Store them securely; this is the only plaintext output.\n\n";
    foreach ($issued as $row) printf("%-6s %s\n", strtoupper($row['role']), $row['key']);
    echo "\nThese keys only replace a user's role when the current role is none. Admin keys grant admin role; distribute only to trusted people.\n";
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "Role key seeding failed: " . $e->getMessage() . "\n");
    exit(1);
}
