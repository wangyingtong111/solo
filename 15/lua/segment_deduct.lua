local segment_count = tonumber(ARGV[1])
local quantity = tonumber(ARGV[2])
local tx_id = ARGV[3]
local expire_ms = tonumber(ARGV[4])

local tx_key = KEYS[1]
local base_key = KEYS[2]

if redis.call('HEXISTS', tx_key, tx_id) == 1 then
    return -2
end

local remaining = quantity
local results = {}

for i = 0, segment_count - 1 do
    if remaining <= 0 then break end

    local seg_key = base_key .. ':seg:' .. i
    local seg_stock = tonumber(redis.call('GET', seg_key) or '0')

    if seg_stock > 0 then
        local deduct = math.min(seg_stock, remaining)
        redis.call('DECRBY', seg_key, deduct)
        remaining = remaining - deduct
        results[#results + 1] = tostring(i) .. ':' .. tostring(deduct)
    end
end

if remaining > 0 then
    for _, r in ipairs(results) do
        local seg_idx, seg_qty = r:match('(%d+):(%d+)')
        local seg_key = base_key .. ':seg:' .. seg_idx
        redis.call('INCRBY', seg_key, tonumber(seg_qty))
    end
    return -1
end

local detail = table.concat(results, ',')
redis.call('HSET', tx_key, tx_id, detail)
redis.call('PEXPIRE', tx_key, expire_ms)

return quantity
